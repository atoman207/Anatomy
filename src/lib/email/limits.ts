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
 * Which way mail leaves the deployment.
 *
 * A shared mailbox (Private Email) and a sending API (Resend) are not the
 * same kind of sender, and mixing them is what wrecks a domain's reputation:
 * a broadcast sent from the mailbox that also answers the contact form makes
 * one unhappy recipient's spam complaint land on replies to customers too.
 * The recommendation in .env.example is to keep the contact mailbox on SMTP
 * and move broadcasts to an API sender on a *subdomain* (news@mail.example.jp),
 * which is what `RESEND_FROM` is for.
 *
 * `EMAIL_PROVIDER` forces one or the other; otherwise the presence of an API
 * key decides, so adding the key is all it takes to switch.
 */
export type EmailProvider = "smtp" | "resend";

export function emailProvider(env: EnvLike = process.env): EmailProvider {
  const explicit = (env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  if (explicit === "smtp") return "smtp";
  if (explicit === "resend") return "resend";
  return env.RESEND_API_KEY ? "resend" : "smtp";
}

/**
 * Hourly defaults for an API sender. Resend's own limit is a request rate
 * (2/second) rather than an hourly quota, so these are a deliberate
 * throttle rather than a transcription of a documented ceiling: a new
 * sending domain earns its volume gradually (see `warmupState`), and an
 * accidental 10,000-recipient send should be paced, not sprayed.
 */
export const DEFAULT_API_MESSAGES_PER_HOUR = 100;
export const DEFAULT_API_RECIPIENTS_PER_HOUR = 2_000;

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
  const fallback =
    emailProvider(env) === "resend"
      ? DEFAULT_API_MESSAGES_PER_HOUR
      : DEFAULT_MAX_MESSAGES_PER_HOUR;
  return readPositiveInt(env.SMTP_MAX_MESSAGES_PER_HOUR, fallback);
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
  const fallback =
    emailProvider(env) === "resend"
      ? DEFAULT_API_RECIPIENTS_PER_HOUR
      : DEFAULT_MAX_RECIPIENTS_PER_HOUR;
  return readPositiveInt(env.SMTP_MAX_RECIPIENTS_PER_HOUR, fallback);
}

/* ------------------------------------------------------------------ */
/* Warm-up                                                             */
/* ------------------------------------------------------------------ */

/**
 * The daily ceiling a new sending domain is allowed, by age in days.
 *
 * Reputation at Gmail and Microsoft is built from a *pattern*, not from
 * authentication alone: a domain that has never sent anything and suddenly
 * mails two thousand people is filtered on volume no matter how correct its
 * SPF, DKIM and DMARC are. Ramping is the whole remedy - a few dozen a day at
 * first, doubling as engagement accumulates, until the domain is established.
 *
 * Roughly the schedule the large mailbox providers themselves describe: about
 * a month to full volume. After day 28 the ramp is over and only the
 * configured hourly ceilings apply.
 */
export const WARMUP_STEPS: readonly { throughDay: number; cap: number }[] = [
  { throughDay: 2, cap: 50 },
  { throughDay: 4, cap: 100 },
  { throughDay: 7, cap: 200 },
  { throughDay: 14, cap: 500 },
  { throughDay: 21, cap: 1_000 },
  { throughDay: 28, cap: 2_000 },
];

export interface WarmupState {
  /** True while the ramp still limits the day's sending. */
  active: boolean;
  /** Day number since `EMAIL_WARMUP_START`, 1 on the first day. */
  day: number;
  /** Addresses allowed in 24 hours, or null when the ramp no longer binds. */
  dailyCap: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Where the sending domain is in its warm-up.
 *
 * Set `EMAIL_WARMUP_START` to the date the domain began sending (YYYY-MM-DD).
 * Unset means no ramp - correct for a mailbox that has been sending for years,
 * and wrong for a domain that was set up last week.
 */
export function warmupState(env: EnvLike = process.env, now: Date = new Date()): WarmupState {
  const raw = (env.EMAIL_WARMUP_START ?? "").trim();
  if (!raw) return { active: false, day: 0, dailyCap: null };

  const started = Date.parse(raw.length === 10 ? `${raw}T00:00:00Z` : raw);
  if (!Number.isFinite(started)) return { active: false, day: 0, dailyCap: null };

  // Day 1 is the start date itself; a start date in the future is treated as
  // day 1 rather than as a negative day, so a typo cannot lift the ceiling.
  const day = Math.max(1, Math.floor((now.getTime() - started) / DAY_MS) + 1);
  const step = WARMUP_STEPS.find((s) => day <= s.throughDay);
  if (!step) return { active: false, day, dailyCap: null };
  return { active: true, day, dailyCap: step.cap };
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
