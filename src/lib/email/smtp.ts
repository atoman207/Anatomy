import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

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

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
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
 * The address recipients will see in From, or null when SMTP is unconfigured.
 * The administrator mailer shows this before a send so it is obvious which
 * mailbox is about to appear in everyone's inbox.
 */
export function emailSenderAddress(): string | null {
  return readConfig()?.from ?? null;
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
  const cfg = readConfig();
  if (!cfg) return { ok: false, error: NOT_CONFIGURED };

  try {
    const transporter = getTransporter(cfg);
    await transporter.sendMail({
      from: formatFrom(cfg.from, input.fromName),
      to: input.to || cfg.to,
      replyTo: input.replyTo,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "メール送信に失敗しました。" };
  }
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
   * Address for a `List-Unsubscribe` header. Bulk mail without one is
   * treated as less trustworthy by receiving providers, and Namecheap
   * requires mass mailings to be opt-in, which implies a way out.
   */
  unsubscribeMailto?: string;
}

export type DeliveryMode = "individual" | "bcc";

export type TransactionResult =
  | { ok: true; recipients: number }
  | { ok: false; recipients: number; error: string };

export async function sendTransaction(
  recipients: readonly BulkRecipient[],
  message: TransactionMessage,
  mode: DeliveryMode,
): Promise<TransactionResult> {
  const cfg = readConfig();
  if (!cfg) return { ok: false, recipients: recipients.length, error: NOT_CONFIGURED };
  if (recipients.length === 0) return { ok: true, recipients: 0 };

  const transporter = getTransporter(cfg);
  const from = formatFrom(cfg.from, message.fromName);
  const headers = message.unsubscribeMailto
    ? { "List-Unsubscribe": `<mailto:${message.unsubscribeMailto}>` }
    : undefined;

  try {
    if (mode === "bcc") {
      await transporter.sendMail({
        from,
        // The mailbox addresses itself; the audience rides in Bcc.
        to: cfg.from,
        bcc: recipients.map((r) => r.email),
        replyTo: message.replyTo,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers,
      });
    } else {
      const recipient = recipients[0];
      await transporter.sendMail({
        from,
        to: recipient.email,
        replyTo: message.replyTo,
        subject: renderTemplate(message.subject, recipient),
        text: renderTemplate(message.text, recipient),
        html: message.html ? renderTemplate(message.html, recipient) : undefined,
        headers,
      });
    }
    return { ok: true, recipients: recipients.length };
  } catch (e) {
    return {
      ok: false,
      recipients: recipients.length,
      error: e instanceof Error ? e.message : "送信に失敗しました。",
    };
  }
}

/** True when the subject or body needs per-recipient substitution. */
export function usesPlaceholders(...templates: (string | undefined)[]): boolean {
  return templates.some((t) => !!t && /\{\{\s*(name|email)\s*\}\}/.test(t));
}
