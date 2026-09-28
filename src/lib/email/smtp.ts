import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

import { emailProvider } from "@/lib/email/limits";
import type { UnsubscribeLinks } from "@/lib/email/compliance";
import {
  resendConfigured, resendSenderAddress, sendViaResend, type DeliveryPayload,
} from "@/lib/email/resend";

/**
 * SMTP sending for the whole deployment, via Namecheap Private Email
 * (mail.privateemail.com). A thin wrapper around nodemailer rather than a
 * hand-rolled SMTP client - unlike the OpenAI wrapper next to this file,
 * SMTP itself (STARTTLS/SSL negotiation, AUTH, MIME) is not a small surface
 * to reimplement, and nodemailer is the well-audited standard for exactly
 * this.
 *
 * Two callers, with deliberately different failure postures:
 *
 *   - the public contact form (src/lib/contact/actions.ts), where the message
 *     is stored in `contact_messages` first and a send failure is logged
 *     rather than shown, and
 *   - the administrator mailer (src/lib/email/adminActions.ts), where the
 *     send *is* the point and every per-recipient outcome is reported back
 *     and recorded.
 *
 * Every credential comes from the environment, never from source - see
 * .env.example.
 */

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  /** Envelope/header From - defaults to the authenticated mailbox. */
  from: string;
  /** Where notifications land - defaults to the authenticated mailbox. */
  to: string;
}

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

export function isEmailConfigured(): boolean {
  return smtpConfigured() || resendConfigured();
}

/**
 * Which transport carries a given message.
 *
 * Transactional mail (the contact form, a test send) stays on the mailbox
 * whenever there is one: it is a reply from a real address that a person may
 * write back to. Broadcasts prefer the API sender when one is configured,
 * because that is the whole point of having it - see resend.ts. Either kind
 * falls back to whatever is actually available, so a deployment with only one
 * of the two still sends.
 */
type MessageKind = "bulk" | "transactional";

function transportFor(kind: MessageKind): "smtp" | "resend" {
  const api = resendConfigured();
  if (!api) return "smtp";
  if (!smtpConfigured()) return "resend";
  if (kind === "bulk") return emailProvider() === "resend" ? "resend" : "smtp";
  return "smtp";
}

function readConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  if (!host || !user || !password) return null;

  const port = Number(process.env.SMTP_PORT || 465);
  // Port 465 is implicit TLS; anything else (587, 25) negotiates STARTTLS.
  // SMTP_SECURE lets either be overridden explicitly if a provider differs.
  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465;

  return {
    host,
    port,
    secure,
    user,
    password,
    from: process.env.SMTP_FROM || user,
    to: process.env.CONTACT_RECEIVE_EMAIL || user,
  };
}

/**
 * The address recipients will see in From, or null when nothing is
 * configured. The administrator mailer shows this before a send so it is
 * obvious which mailbox is about to appear in everyone's inbox - and with an
 * API sender that is a different address from the contact mailbox, so it is
 * resolved per message kind rather than read straight off the SMTP config.
 */
export function emailSenderAddress(kind: MessageKind = "bulk"): string | null {
  if (transportFor(kind) === "resend") return resendSenderAddress();
  return readConfig()?.from ?? null;
}

/** Where a message with no explicit recipient goes: the deployment's inbox. */
function defaultInbox(): string | null {
  return process.env.CONTACT_RECEIVE_EMAIL || readConfig()?.to || resendSenderAddress();
}

/**
 * Hands one built message to whichever transport this kind uses. Everything
 * above this line is about *what* to send; this is the only place that knows
 * how it leaves the building.
 */
async function deliver(payload: DeliveryPayload, kind: MessageKind): Promise<SendMailResult> {
  if (transportFor(kind) === "resend") return await sendViaResend(payload);

  const cfg = readConfig();
  if (!cfg) return { ok: false, error: NOT_CONFIGURED };
  try {
    await getTransporter(cfg).sendMail({
      from: payload.from,
      to: payload.to,
      bcc: payload.bcc,
      replyTo: payload.replyTo,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      headers: payload.headers,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "メール送信に失敗しました。" };
  }
}

/**
 * `List-Unsubscribe`, and its one-click companion.
 *
 * Both headers, not one: mail clients show the "unsubscribe" button from
 * `List-Unsubscribe`, while `List-Unsubscribe-Post` is the promise that the
 * HTTPS entry can be POSTed with nobody watching (RFC 8058) - which is what
 * Gmail and Yahoo's bulk-sender rules ask for. It is only ever sent when the
 * URL identifies one recipient: promising one-click for a page that has to
 * ask "which address?" would break the button rather than satisfy the rule.
 */
function unsubscribeHeaders(links: UnsubscribeLinks): Record<string, string> | undefined {
  const entries: string[] = [];
  if (links.url) entries.push(`<${links.url}>`);
  if (links.mailto) entries.push(`<mailto:${links.mailto}?subject=unsubscribe>`);
  if (entries.length === 0) return undefined;

  const headers: Record<string, string> = { "List-Unsubscribe": entries.join(", ") };
  if (links.oneClick && links.url) {
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  return headers;
}

// Reused across invocations in the same server process - nodemailer pools the
// underlying connection, so repeated sends do not each pay a fresh TLS
// handshake. The pool matters most for the administrator mailer, which sends
// one message per recipient rather than one message with many recipients.
// rateLimit is a courtesy to the provider, not a correctness measure: Private
// Email throttles bursts, and a broadcast that trips that throttle fails
// partway through with an error that says nothing useful.
let cachedTransporter: Transporter | null = null;
let cachedForUser: string | null = null;

function getTransporter(cfg: SmtpConfig): Transporter {
  if (cachedTransporter && cachedForUser === cfg.user) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    pool: true,
    // One connection, one message per second. The binding constraint is the
    // provider's *hourly* ceiling, enforced in campaign.ts against the rate
    // log; this is just the last line of defence against a burst. It used to
    // be 3 connections at 5/second - nearly 18,000 messages an hour, which
    // is two orders of magnitude past what the mailbox permits.
    maxConnections: 1,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: 1,
  });
  cachedForUser = cfg.user;
  return cachedTransporter;
}

/** `From` header value - a display name makes a broadcast look less like spam. */
function formatFrom(address: string, name?: string): string {
  if (!name) return address;
  // Quote the display name so a comma or colon inside it cannot split the header.
  return `"${name.replace(/["\\]/g, "")}" <${address}>`;
}

export interface SendMailInput {
  /** Destination address - defaults to the configured inbox. */
  to?: string;
  subject: string;
  text: string;
  /** Optional HTML alternative; `text` is still sent as the fallback part. */
  html?: string;
  /** Set to the form submitter's address so a reply goes straight to them. */
  replyTo?: string;
  /** Display name shown in From, e.g. "LABNOTE". */
  fromName?: string;
}

export type SendMailResult = { ok: true } | { ok: false; error: string };

const NOT_CONFIGURED =
  "SMTPが設定されていません（SMTP_HOST / SMTP_USER / SMTP_PASSWORD）。";

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const from = emailSenderAddress("transactional");
  const to = input.to || defaultInbox();
  if (!from || !to) return { ok: false, error: NOT_CONFIGURED };

  return await deliver(
    {
      from: formatFrom(from, input.fromName),
      to,
      replyTo: input.replyTo,
      subject: input.subject,
      text: input.text,
      html: input.html,
    },
    // No unsubscribe footer here on purpose: a contact-form notification is
    // correspondence, not a mailing. Adding an opt-out to mail somebody asked
    // for is both meaningless and a way to lose replies.
    "transactional",
  );
}

/* ------------------------------------------------------------------ */
/* Bulk sending                                                        */
/* ------------------------------------------------------------------ */

export interface BulkRecipient {
  email: string;
  /** Substituted into `{{name}}`; falls back to the local part of the address. */
  name?: string | null;
  /** Opaque here - echoed back so the caller can match an outcome to its row. */
  userId?: string | null;
}

export interface BulkOutcome extends BulkRecipient {
  ok: boolean;
  error?: string;
}

export interface BulkMessage {
  subject: string;
  /** Plain-text body. `{{name}}` / `{{email}}` are substituted per recipient. */
  text: string;
  /** HTML body, substituted the same way. Omit for a plain-text-only send. */
  html?: string;
  replyTo?: string;
  fromName?: string;
}

/**
 * Substitutes the per-recipient placeholders an administrator may use in a
 * subject or body. Deliberately a fixed, tiny set rather than a template
 * language: every value comes from the recipient row itself, so there is
 * nothing reachable here that the author could not simply have typed.
 */
export function renderTemplate(template: string, recipient: BulkRecipient): string {
  // Trimmed *before* the fallback, not after: a display name that is nothing
  // but spaces is not a name, and letting it through would address someone as
  // "  様" - worse than the local part of their own address.
  const name = recipient.name?.trim() || recipient.email.split("@")[0] || "";
  return template
    .replace(/\{\{\s*name\s*\}\}/g, name)
    .replace(/\{\{\s*email\s*\}\}/g, recipient.email);
}

/**
 * Sends exactly one SMTP transaction, to one recipient or to a batch.
 *
 * One transaction is the unit the provider's hourly limit counts, so it is
 * also the unit this function exposes: the caller (src/lib/email/campaign.ts)
 * owns how many of these it is allowed to start, and this owns what one of
 * them looks like on the wire. Splitting it that way is what lets the budget
 * be enforced against the database rather than hoped for.
 *
 * In "bcc" mode every address goes in Bcc and the To header is the sending
 * mailbox itself, so recipients still cannot see one another - Bcc is not
 * disclosed to other recipients - while 45 people cost one message instead
 * of 45. Placeholders cannot be substituted in that mode, because there is
 * one body for the whole batch; `campaign.ts` refuses bcc mode when the
 * message uses `{{name}}` for exactly that reason.
 */
export interface TransactionMessage {
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  fromName?: string;
  /**
   * The unsubscribe routes for one recipient - null when the message is a Bcc
   * batch, where no single address can be identified and one-click is
   * therefore impossible.
   *
   * A function rather than a value because the HTTPS link carries a signed
   * address: every recipient of an individually-sent campaign gets their own.
   */
  unsubscribe?: (email: string | null) => UnsubscribeLinks;
  /**
   * The footer appended to the body, built from the same links the headers
   * use so the two cannot disagree. Carries the sender identification that
   * 特定電子メール法 requires - see compliance.ts.
   */
  footer?: (links: UnsubscribeLinks) => { text: string; html: string };
}

export type DeliveryMode = "individual" | "bcc";

export type TransactionResult =
  | { ok: true; recipients: number }
  | { ok: false; recipients: number; error: string };

/**
 * Builds one message's subject, body and unsubscribe headers.
 *
 * `recipient` is null for a Bcc batch: placeholders are left alone (there is
 * one body for everyone) and the unsubscribe links are resolved for nobody in
 * particular, which is what suppresses the one-click header.
 */
function composeMessage(
  message: TransactionMessage,
  recipient: BulkRecipient | null,
): { subject: string; text: string; html?: string; headers?: Record<string, string> } {
  const links = message.unsubscribe?.(recipient?.email ?? null) ?? { oneClick: false };
  const subject = recipient ? renderTemplate(message.subject, recipient) : message.subject;
  let text = recipient ? renderTemplate(message.text, recipient) : message.text;
  let html = message.html
    ? recipient
      ? renderTemplate(message.html, recipient)
      : message.html
    : undefined;

  const footer = message.footer?.(links);
  if (footer) {
    text = `${text.trimEnd()}\n\n${footer.text}\n`;
    if (html !== undefined) html = `${html}\n${footer.html}`;
  }

  return { subject, text, html, headers: unsubscribeHeaders(links) };
}

export async function sendTransaction(
  recipients: readonly BulkRecipient[],
  message: TransactionMessage,
  mode: DeliveryMode,
): Promise<TransactionResult> {
  if (recipients.length === 0) return { ok: true, recipients: 0 };

  const fromAddress = emailSenderAddress("bulk");
  if (!fromAddress) return { ok: false, recipients: recipients.length, error: NOT_CONFIGURED };
  const from = formatFrom(fromAddress, message.fromName);

  const single = mode === "bcc" ? null : recipients[0];
  const built = composeMessage(message, single);

  const result = await deliver(
    {
      from,
      // Bcc mode: the mailbox addresses itself and the audience rides along
      // in Bcc, so no recipient learns who else was written to.
      to: single ? single.email : fromAddress,
      bcc: single ? undefined : recipients.map((r) => r.email),
      replyTo: message.replyTo,
      subject: built.subject,
      text: built.text,
      html: built.html,
      headers: built.headers,
    },
    "bulk",
  );

  return result.ok
    ? { ok: true, recipients: recipients.length }
    : { ok: false, recipients: recipients.length, error: result.error };
}

/** True when the subject or body needs per-recipient substitution. */
export function usesPlaceholders(...templates: (string | undefined)[]): boolean {
  return templates.some((t) => !!t && /\{\{\s*(name|email)\s*\}\}/.test(t));
}
