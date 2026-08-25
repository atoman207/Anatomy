import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

/**
 * Minimal SMTP sender for the contact form, via Namecheap Private Email
 * (mail.privateemail.com). A thin wrapper around nodemailer rather than a
 * hand-rolled SMTP client - unlike the OpenAI wrapper next to this file,
 * SMTP itself (STARTTLS/SSL negotiation, AUTH, MIME) is not a small surface
 * to reimplement, and nodemailer is the well-audited standard for exactly
 * this.
 *
 * Every credential comes from the environment, never from source - see
 * .env.example. Email is a best-effort notification, not the record of
 * truth: `submitContactMessage` in src/lib/contact/actions.ts stores the
 * message in `contact_messages` first, and treats a failure here as
 * something to log, not something that should make an already-recorded
 * submission look like it failed to the visitor who sent it.
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

// Reused across invocations in the same server process - nodemailer pools
// the underlying connection, so repeated sends do not each pay a fresh
// TLS handshake.
let cachedTransporter: Transporter | null = null;
let cachedForUser: string | null = null;

function getTransporter(cfg: SmtpConfig): Transporter {
  if (cachedTransporter && cachedForUser === cfg.user) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
  });
  cachedForUser = cfg.user;
  return cachedTransporter;
}

export interface SendMailInput {
  subject: string;
  text: string;
  /** Set to the form submitter's address so a reply goes straight to them. */
  replyTo?: string;
}

export type SendMailResult = { ok: true } | { ok: false; error: string };

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const cfg = readConfig();
  if (!cfg) return { ok: false, error: "SMTPが設定されていません（SMTP_HOST / SMTP_USER / SMTP_PASSWORD）。" };

  try {
    const transporter = getTransporter(cfg);
    await transporter.sendMail({
      from: cfg.from,
      to: cfg.to,
      replyTo: input.replyTo,
      subject: input.subject,
      text: input.text,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "メール送信に失敗しました。" };
  }
}
