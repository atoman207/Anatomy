/**
 * The provider's sending limits, and how to recognise being throttled by
 * them.
 *
 * Namecheap Private Email (mail.privateemail.com) enforces two independent
 * ceilings, and a bulk send has to respect both:
 *
 *   - messages per hour, per mailbox: 20 on a trial plan, 500 on the paid
 *     Launch/Expand/Scale plans (legacy Private/Business: 500 per *domain*,
 *     Pro 1000, Ultimate 1500). It is a trailing 60-minute window, not a
 *     clock hour that resets on the hour.
 *   - recipients per message: 50, counted across To, Cc and Bcc together.
 *
 * The second one is the lever that makes a large send possible at all. One
 * message addressed to 45 people in Bcc is one message against the hourly
 * ceiling, so batching multiplies the reachable audience by roughly 45 while
 * staying inside the same limit.
 *
 * Both are configurable, because they are properties of the mailbox's plan
 * rather than of this code: an upgrade should be a change of environment
 * variable, not a code change. The defaults are the trial figures, which is
 * the safe direction to be wrong in - guessing high is what produces the
 * "554 5.7.1 ... too many messages from sender in last 60 minutes" rejection
 * this module exists to avoid.
 *
 * Namecheap's own policy: mass mailings must be double opt-in, and a script
 * that keeps violating the sending limits gets the mailbox disabled pending
 * a support conversation. Staying under the ceiling is not politeness, it is
 * what keeps the mailbox working.
 */

/** Hard provider cap on To + Cc + Bcc in a single message. Not configurable. */
export const PROVIDER_MAX_RECIPIENTS_PER_MESSAGE = 50;

/** Trial-plan hourly message ceiling - the conservative default. */
export const DEFAULT_MAX_MESSAGES_PER_HOUR = 20;

/**
 * Bcc recipients per message. Kept a little under the provider's 50 so the
 * To header (the sending mailbox itself) and any Reply-To do not push the
 * message over the line.
 */
export const DEFAULT_MAX_RECIPIENTS_PER_MESSAGE = 45;

/**
 * Recipients per trailing hour - a second ceiling, independent of the
 * message count.
 *
 * It exists because Namecheap's "500 emails/hour" is not explicit about what
 * an "email" is when one message carries 45 people in Bcc. The wording of
 * the rejection ("too many *messages* from sender") and the separate
 * 50-recipients-per-message rule both indicate messages are counted, which
 * would make the reachable audience 500 x 45. But that is an inference, not
 * a documented guarantee, and being wrong about it means mass rejections.
 *
 * 500 is the default because it is safe under *either* reading: 500
 * recipients is within the limit whether the provider counts messages or
 * addresses. Raise it only after confirming with the provider how Bcc
 * recipients are counted - and note that exceeding it is not an error here
 * anyway, it just queues the remainder for the next hour.
 */
export const DEFAULT_MAX_RECIPIENTS_PER_HOUR = 500;

/** Just the shape these readers need, so a test can pass a bare object. */
export type EnvLike = Record<string, string | undefined>;

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

/**
 * How many SMTP transactions may be started in a trailing hour.
 *
 * Set `SMTP_MAX_MESSAGES_PER_HOUR` to the mailbox's actual plan limit (500
 * for a paid Private Email plan). Leaving it unset assumes the trial limit.
 */
export function maxMessagesPerHour(env: EnvLike = process.env): number {
  return readPositiveInt(env.SMTP_MAX_MESSAGES_PER_HOUR, DEFAULT_MAX_MESSAGES_PER_HOUR);
}

/**
 * How many individual addresses may be reached in a trailing hour, across
 * however many messages that takes.
 *
 * Set `SMTP_MAX_RECIPIENTS_PER_HOUR` to raise it. See the note on
 * `DEFAULT_MAX_RECIPIENTS_PER_HOUR` for why the default is deliberately the
 * cautious reading of the provider's limit.
 */
export function maxRecipientsPerHour(env: EnvLike = process.env): number {
  return readPositiveInt(
    env.SMTP_MAX_RECIPIENTS_PER_HOUR,
    DEFAULT_MAX_RECIPIENTS_PER_HOUR,
  );
}

/**
 * How many recipients may share one message in Bcc, clamped to the
 * provider's hard cap - a larger configured value would simply produce
 * rejected messages.
 */
export function maxRecipientsPerMessage(env: EnvLike = process.env): number {
  const configured = readPositiveInt(
    env.SMTP_MAX_RECIPIENTS_PER_MESSAGE,
    DEFAULT_MAX_RECIPIENTS_PER_MESSAGE,
  );
  return Math.min(configured, PROVIDER_MAX_RECIPIENTS_PER_MESSAGE);
}

/** Splits a list into consecutive groups of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const safe = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += safe) {
    out.push(items.slice(i, i + safe));
  }
  return out;
}

/**
 * True when the server is refusing because *this sender has sent too much*,
 * as opposed to something wrong with the message or the address.
 *
 * The distinction decides what happens next, so it is worth getting right:
 * a throttled send must stop immediately and continue later (every further
 * attempt inside the window is both futile and, per Namecheap's policy, a
 * step towards having the mailbox disabled), while a rejected *address*
 * should be recorded and skipped so the rest of the campaign proceeds.
 *
 * Matched on the wording rather than the status code alone, because the code
 * is ambiguous: 554 5.7.1 is also what a plain relay denial returns.
 */
export function isRateLimitError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("too many messages") ||
    m.includes("too many recipients") ||
    m.includes("too many emails") ||
    m.includes("rate limit") ||
    m.includes("ratelimit") ||
    m.includes("sending limit") ||
    m.includes("quota exceeded") ||
    m.includes("exceeded the maximum") ||
    m.includes("throttl") ||
    // Namecheap's wording for the hourly ceiling.
    (m.includes("data command rejected") && m.includes("reject")) ||
    // Standard temporary-throttle enhanced status codes.
    m.includes("4.7.0") ||
    m.includes("4.7.1") ||
    m.includes("452 4.5.3")
  );
}

/**
 * True when retrying the same message later has a real chance of working:
 * connection trouble and 4xx temporary failures. A 5xx rejection of the
 * address itself is permanent and must not be retried.
 */
export function isTransientError(message: string): boolean {
  const m = message.toLowerCase();
  if (isRateLimitError(message)) return true;
  return (
    m.includes("timeout") ||
    m.includes("etimedout") ||
    m.includes("econnreset") ||
    m.includes("econnrefused") ||
    m.includes("esocket") ||
    m.includes("socket close") ||
    m.includes("connection closed") ||
    m.includes("dns") ||
    m.includes("temporarily") ||
    m.includes("try again") ||
    /\b4\d\d\b/.test(m)
  );
}

/**
 * The number of messages a campaign of this size needs, given the batching
 * in force. Used to tell the administrator up front whether the whole
 * campaign fits in the current hour or will be finished later.
 */
export function messagesNeeded(recipientCount: number, perMessage: number): number {
  if (recipientCount <= 0) return 0;
  return Math.ceil(recipientCount / Math.max(1, perMessage));
}
