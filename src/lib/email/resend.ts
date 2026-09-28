import "server-only";

/**
 * Delivery through Resend's HTTP API, as an alternative to the SMTP mailbox.
 *
 * Why a second way out at all. Broadcasts and transactional mail want
 * opposite things from a sender. The contact mailbox needs a reputation
 * nobody can damage; a newsletter is exactly what damages one. Sending both
 * from `contact@labnote.site` means a single spam complaint about an
 * announcement also degrades delivery of replies to customers - and the
 * mailbox's own ceiling (20 messages an hour on a trial plan) makes any real
 * audience take days.
 *
 * So the recommended arrangement is:
 *
 *   - contact form and replies: SMTP, the existing mailbox, unchanged.
 *   - broadcasts: this, from a *subdomain* (`news@mail.labnote.site`), with
 *     its own SPF, DKIM and DMARC. A complaint there cannot touch the parent
 *     domain's reputation.
 *
 * Nothing here activates until `RESEND_API_KEY` is set, and `EMAIL_PROVIDER`
 * can pin either direction - see `emailProvider` in limits.ts. The API shape
 * is deliberately the same as what smtp.ts hands nodemailer, so the caller
 * (sendTransaction) does not know which one it is using.
 */

const ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 15_000;

/** One message as both transports accept it. */
export interface DeliveryPayload {
  /** `"Name" <address>` or a bare address. */
  from: string;
  to: string;
  bcc?: string[];
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
}

export type DeliveryResult = { ok: true } | { ok: false; error: string };

export function resendConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.RESEND_API_KEY);
}

/**
 * The From address for API-sent mail.
 *
 * `RESEND_FROM` is separate from `SMTP_FROM` on purpose: they should not be
 * the same address. Falling back to `SMTP_FROM` keeps a half-configured
 * deployment working, but it gives up the reputation separation that is the
 * main reason to send this way.
 */
export function resendSenderAddress(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.RESEND_FROM || env.SMTP_FROM || null;
}

export async function sendViaResend(
  payload: DeliveryPayload,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DeliveryResult> {
  const key = env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY が設定されていません。" };

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: payload.from,
        to: [payload.to],
        bcc: payload.bcc?.length ? payload.bcc : undefined,
        reply_to: payload.replyTo,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
        headers: payload.headers,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (response.ok) return { ok: true };

    const detail = await response.text().catch(() => "");
    let message = detail.slice(0, 300);
    try {
      const parsed = JSON.parse(detail) as { message?: string; name?: string };
      if (parsed.message) message = parsed.message;
    } catch {
      // Not JSON - the raw body is the best description available.
    }
    // Worded so limits.ts recognises a throttle: the campaign has to stop on
    // one rather than march the rest of the list into the same wall.
    if (response.status === 429) return { ok: false, error: `rate limit (429): ${message}` };
    return { ok: false, error: `Resend ${response.status}: ${message}` };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "不明なエラー";
    // A timeout or a dropped connection is retryable, and isTransientError
    // reads these words - keep them in the message.
    return { ok: false, error: `Resend への接続に失敗しました（${reason}）` };
  }
}
