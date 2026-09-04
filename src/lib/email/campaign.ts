import "server-only";

/**
 * Delivery for an administrator broadcast: how much may be sent right now,
 * and what happens to the rest.
 *
 * The problem this solves. Namecheap Private Email allows a fixed number of
 * messages per mailbox in a trailing 60-minute window (20 on trial, 500 on a
 * paid plan). A campaign that ignores this does not fail cleanly - it
 * delivers the first N, then collects "554 5.7.1 ... too many messages from
 * sender in last 60 minutes" for every remaining recipient, one wasted SMTP
 * transaction at a time, and Namecheap's stated policy is to disable a
 * mailbox whose scripts keep doing that.
 *
 * So a campaign is a queue, not a single act:
 *
 *   1. Every recipient is written as `pending` before anything is sent.
 *   2. This module sends as many transactions as the hour's remaining budget
 *      allows, marking each recipient `sent` or `failed` as it goes.
 *   3. The moment the server says "too much", it stops - the remainder stay
 *      `pending`, to be picked up by a later run.
 *
 * Nothing is ever dropped on the floor, and no recipient is attempted while
 * the mailbox is known to be throttled.
 *
 * The two multipliers that make large sends practical:
 *
 *   - Bcc batching. One message to 45 addresses in Bcc is *one* message
 *     against the hourly limit, so the reachable audience per hour is the
 *     message budget times 45. Recipients still cannot see each other.
 *   - The budget is counted in the database (`admin_email_rate_log`), not in
 *     process memory, so a restart or a second instance cannot hand itself a
 *     fresh allowance the provider will not honour.
 *
 * Both of those tables came in a later migration section, so everything here
 * also works without them - see `EmailSchema` and `sendCampaignDirect`. The
 * degraded path gives up resumability, not safety: batching and stopping on
 * the first throttle rejection do not depend on any schema.
 */

import { createAdminSupabase } from "@/lib/supabase/server";
import {
  chunk, isRateLimitError, isTransientError, maxMessagesPerHour, maxRecipientsPerHour,
  maxRecipientsPerMessage,
} from "@/lib/email/limits";
import { htmlToText } from "@/lib/email/compose";
import {
  sendTransaction, type BulkRecipient, type DeliveryMode, type TransactionMessage,
} from "@/lib/email/smtp";
import type { AdminEmailMessageRow } from "@/lib/supabase/types";

/** The display name recipients see beside the From address. */
export const FROM_NAME = "LABNOTE";

/**
 * How many times one recipient may be attempted before being called failed.
 * Only transient errors consume an attempt more than once - a rejected
 * address fails on the first try and is not retried.
 */
const MAX_ATTEMPTS = 3;

/**
 * A ceiling on one dispatch run, independent of the hourly budget. A server
 * action holds an HTTP request open, so a run that would take ten minutes
 * needs to stop and leave the rest pending instead. At roughly one message
 * per second this is a few thousand batched recipients per run - well past
 * anything the hourly budget allows on a trial plan, and enough that a paid
 * plan's full allowance takes a handful of runs rather than hundreds.
 */
const MAX_RUN_MS = 120_000;

/** Pause between transactions, so a burst never looks like an attack. */
const GAP_MS = 250;

/**
 * Which parts of the delivery schema this database actually has.
 *
 * The rate ledger and the per-recipient `status` column arrived in a later
 * migration section, and a deployment can be running this code before that
 * SQL has been pasted in. Rather than refusing to send until it is - which
 * takes the whole feature offline over an optional upgrade - the two
 * capabilities are probed and the sender degrades:
 *
 *   - with `queue`: recipients are queued and a campaign resumes across
 *     hours, which is the full behaviour.
 *   - without it: the campaign is capped to what this hour can carry and
 *     sent immediately, and the administrator is told how many were held
 *     back. Batching and the stop-on-throttle rule still apply, so the
 *     mass-rejection failure cannot recur either way.
 */
export interface EmailSchema {
  /** `admin_email_rate_log` exists - the budget can be counted exactly. */
  rateLog: boolean;
  /** `admin_email_recipients.status` exists - campaigns can be resumed. */
  queue: boolean;
}

export async function readEmailSchema(): Promise<EmailSchema> {
  const admin = createAdminSupabase();
  // Deliberately NOT `head: true`. PostgREST answers a head request with
  // 204 No Content even when the relation does not exist, so supabase-js
  // reports no error and a missing table probes as present. Asking for one
  // real row costs nothing and returns the actual PGRST205 / 42703.
  const [rateLog, queue] = await Promise.all([
    admin.from("admin_email_rate_log").select("id").limit(1),
    admin.from("admin_email_recipients").select("status").limit(1),
  ]);
  return { rateLog: !rateLog.error, queue: !queue.error };
}

/**
 * Best-effort trailing-hour record for deployments with no rate ledger.
 *
 * Process-local, so it is lost on restart and not shared between instances -
 * which is exactly why the ledger exists. It is still worth keeping: within
 * one process it stops a second campaign from walking into the limit the
 * first one just reached. The hard guarantee comes from stopping on the
 * first throttle rejection, which needs no bookkeeping at all.
 */
const inMemorySends: { at: number; recipients: number }[] = [];

function recordInMemory(recipients: number): void {
  inMemorySends.push({ at: Date.now(), recipients });
}

function countInMemory(): { messages: number; recipients: number; oldest: number | null } {
  const cutoff = Date.now() - 60 * 60 * 1000;
  while (inMemorySends.length > 0 && inMemorySends[0].at < cutoff) inMemorySends.shift();
  return {
    messages: inMemorySends.length,
    recipients: inMemorySends.reduce((sum, s) => sum + s.recipients, 0),
    oldest: inMemorySends[0]?.at ?? null,
  };
}

export interface RateBudget {
  /** Transactions allowed per trailing hour (the plan's limit). */
  perHour: number;
  /** Transactions already used inside the current window. */
  used: number;
  /** Transactions still available right now. */
  remaining: number;
  /** Addresses allowed per trailing hour - the second, independent ceiling. */
  recipientsPerHour: number;
  /** Addresses already reached inside the current window. */
  recipientsUsed: number;
  /** Addresses still reachable right now. */
  recipientsRemaining: number;
  /**
   * When the oldest in-window transaction ages out, freeing capacity again.
   * Null when nothing has been sent in the last hour.
   */
  resetsAt: string | null;
  /**
   * False when `admin_email_rate_log` is not there yet, so `used` came from
   * the process-local record instead. Reported so the UI can say the budget
   * is only approximate and recommend applying the migration, rather than
   * quietly presenting a number that resets whenever the server does.
   */
  ledgerReady: boolean;
}

/**
 * Reads the trailing-hour budget from the rate log.
 *
 * A trailing window, not a clock hour: the provider counts the last 60
 * minutes from now, so capacity returns gradually rather than all at once on
 * the hour.
 */
export async function readBudget(): Promise<RateBudget> {
  const perHour = maxMessagesPerHour();
  const recipientsPerHour = maxRecipientsPerHour();
  const admin = createAdminSupabase();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from("admin_email_rate_log")
    .select("sent_at, recipients")
    .gte("sent_at", since)
    .order("sent_at", { ascending: true });

  // No ledger yet: fall back to the process-local record rather than
  // reporting zero capacity, which would look like a permanent throttle and
  // take sending offline over a migration that has not been pasted in.
  if (error) {
    const local = countInMemory();
    return {
      perHour,
      used: local.messages,
      remaining: Math.max(0, perHour - local.messages),
      recipientsPerHour,
      recipientsUsed: local.recipients,
      recipientsRemaining: Math.max(0, recipientsPerHour - local.recipients),
      resetsAt: local.oldest
        ? new Date(local.oldest + 60 * 60 * 1000).toISOString()
        : null,
      ledgerReady: false,
    };
  }

  const rows = data ?? [];
  const used = rows.length;
  const recipientsUsed = rows.reduce((sum, r) => sum + (r.recipients ?? 1), 0);
  const oldest = rows[0]?.sent_at ?? null;
  return {
    perHour,
    used,
    remaining: Math.max(0, perHour - used),
    recipientsPerHour,
    recipientsUsed,
    recipientsRemaining: Math.max(0, recipientsPerHour - recipientsUsed),
    resetsAt: oldest ? new Date(new Date(oldest).getTime() + 60 * 60 * 1000).toISOString() : null,
    ledgerReady: true,
  };
}

/**
 * Notes one SMTP transaction against the hourly budget.
 *
 * Always updates the process-local record, and additionally the durable
 * ledger when the table is there. Never throws: losing a budget entry must
 * not abort a send that already happened, and the throttle-detection path is
 * what actually protects the mailbox.
 */
async function recordTransaction(recipients: number, messageId?: string): Promise<void> {
  recordInMemory(recipients);
  // Returns `{ error }` rather than throwing, so a missing ledger table is
  // simply an error to ignore: the in-memory record above stands in for it.
  await createAdminSupabase()
    .from("admin_email_rate_log")
    .insert({ message_id: messageId ?? null, recipients });
}

export interface DispatchResult {
  /** Recipients delivered in this run. */
  sent: number;
  /** Recipients that failed permanently in this run. */
  failed: number;
  /** Recipients still waiting after this run. */
  pending: number;
  /** SMTP transactions this run used. */
  messages: number;
  /** True when the provider throttled us and the run stopped early. */
  rateLimited: boolean;
  /** True when the run stopped because the hourly budget was already spent. */
  budgetExhausted: boolean;
  /** When capacity next frees up, if anything is still pending. */
  resetsAt: string | null;
  deliveryMode: DeliveryMode;
}

/**
 * Sends as much of one campaign's pending list as the hour allows.
 *
 * Safe to call again at any time: it only ever reads rows still marked
 * `pending`, so a second call continues rather than re-sending.
 */
export async function dispatchMessage(messageId: string): Promise<DispatchResult> {
  const admin = createAdminSupabase();

  const { data: messageRow, error: messageError } = await admin
    .from("admin_email_messages")
    .select("*")
    .eq("id", messageId)
    .maybeSingle();
  if (messageError) throw new Error(messageError.message);
  if (!messageRow) throw new Error("送信レコードが見つかりません。");
  const message = messageRow as AdminEmailMessageRow;

  const mode: DeliveryMode = message.delivery_mode === "bcc" ? "bcc" : "individual";
  const perMessage = mode === "bcc" ? maxRecipientsPerMessage() : 1;

  const { data: pendingRows, error: pendingError } = await admin
    .from("admin_email_recipients")
    .select("id, email, user_id, attempts, display_name")
    .eq("message_id", messageId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (pendingError) throw new Error(pendingError.message);

  const queue = (pendingRows ?? []).map((r) => ({
    id: r.id as string,
    email: r.email as string,
    attempts: (r.attempts ?? 0) as number,
    recipient: {
      email: r.email as string,
      // Captured at queue time, so {{name}} reads the same whether the
      // message goes out now or when the queue is resumed tomorrow.
      name: (r.display_name ?? null) as string | null,
      userId: (r.user_id ?? null) as string | null,
    } satisfies BulkRecipient,
  }));

  const budget = await readBudget();
  const payload: TransactionMessage = {
    subject: message.subject,
    text: message.body_format === "html" ? htmlToText(message.body) : message.body,
    html: message.body_format === "html" ? message.body : undefined,
    replyTo: message.reply_to ?? message.from_address ?? undefined,
    fromName: FROM_NAME,
    // Bulk mail needs a documented way out; receiving providers weigh its
    // absence, and an opt-in list implies an opt-out path.
    unsubscribeMailto: message.reply_to ?? message.from_address ?? undefined,
  };

  const batches = chunk(queue, perMessage);
  const startedAt = Date.now();
  let sent = 0;
  let failed = 0;
  let messages = 0;
  let rateLimited = false;
  let usedBudget = budget.used;
  let usedRecipients = budget.recipientsUsed;

  for (const batch of batches) {
    if (usedBudget >= budget.perHour) break;
    // The recipient ceiling binds independently of the message ceiling: a
    // batched campaign spends few messages but many addresses, so checking
    // only the message count would sail past it.
    if (usedRecipients + batch.length > budget.recipientsPerHour) break;
    if (Date.now() - startedAt > MAX_RUN_MS) break;
    if (messages > 0 && GAP_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, GAP_MS));
    }

    const result = await sendTransaction(batch.map((b) => b.recipient), payload, mode);
    messages++;
    usedBudget++;
    usedRecipients += batch.length;

    // Logged whether or not it succeeded: a rejected attempt still counted
    // against the mailbox as far as the provider is concerned, and treating
    // it as free is how a throttled sender keeps digging.
    await recordTransaction(batch.length, messageId);

    if (result.ok) {
      sent += batch.length;
      await admin
        .from("admin_email_recipients")
        .update({
          status: "sent",
          ok: true,
          error: null,
          sent_at: new Date().toISOString(),
        })
        .in("id", batch.map((b) => b.id));
      continue;
    }

    const error = result.error;

    if (isRateLimitError(error)) {
      // Stop the whole run. These recipients keep their pending status and
      // do not burn an attempt: nothing was wrong with them.
      rateLimited = true;
      await admin
        .from("admin_email_recipients")
        .update({ error })
        .in("id", batch.map((b) => b.id));
      break;
    }

    const retryable = isTransientError(error);
    const exhausted = batch.filter((b) => !retryable || b.attempts + 1 >= MAX_ATTEMPTS);
    const keepPending = batch.filter((b) => retryable && b.attempts + 1 < MAX_ATTEMPTS);

    if (exhausted.length > 0) {
      failed += exhausted.length;
      await admin
        .from("admin_email_recipients")
        .update({ status: "failed", ok: false, error, attempts: MAX_ATTEMPTS })
        .in("id", exhausted.map((b) => b.id));
    }
    for (const item of keepPending) {
      await admin
        .from("admin_email_recipients")
        .update({ error, attempts: item.attempts + 1 })
        .eq("id", item.id);
    }
  }

  // Counted from the table rather than from the loop, so the totals are the
  // campaign's real state even if two runs overlapped.
  const totals = await countRecipients(messageId);
  const after = await readBudget();

  await admin
    .from("admin_email_messages")
    .update({
      sent_count: totals.sent,
      failed_count: totals.failed,
      pending_count: totals.pending,
      message_count: (message.message_count ?? 0) + messages,
      status: totals.pending > 0 ? "partial" : "complete",
    })
    .eq("id", messageId);

  return {
    sent,
    failed,
    pending: totals.pending,
    messages,
    rateLimited,
    budgetExhausted: !rateLimited && totals.pending > 0 && after.remaining === 0,
    resetsAt: totals.pending > 0 ? after.resetsAt : null,
    deliveryMode: mode,
  };
}

async function countRecipients(
  messageId: string,
): Promise<{ sent: number; failed: number; pending: number }> {
  const admin = createAdminSupabase();
  const counts = { sent: 0, failed: 0, pending: 0 };
  for (const status of ["sent", "failed", "pending"] as const) {
    const { count } = await admin
      .from("admin_email_recipients")
      .select("id", { count: "exact", head: true })
      .eq("message_id", messageId)
      .eq("status", status);
    counts[status] = count ?? 0;
  }
  return counts;
}

/**
 * Every campaign with recipients still waiting, oldest first - what a
 * scheduled dispatch works through, and what the admin page offers a
 * "continue" button for.
 */
export async function listPendingCampaigns(limit = 20): Promise<
  { id: string; subject: string; pending: number; createdAt: string }[]
> {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("admin_email_messages")
    .select("id, subject, pending_count, created_at")
    .gt("pending_count", 0)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) return [];
  return (data ?? []).map((m) => ({
    id: m.id,
    subject: m.subject,
    pending: m.pending_count,
    createdAt: m.created_at,
  }));
}

/* ------------------------------------------------------------------ */
/* Delivery without the queue columns                                  */
/* ------------------------------------------------------------------ */

export interface DirectSendResult {
  sent: number;
  failed: number;
  /** Recipients deliberately not attempted, because the hour cannot carry them. */
  deferred: number;
  messages: number;
  rateLimited: boolean;
  resetsAt: string | null;
  deliveryMode: DeliveryMode;
  /** Per-recipient outcome for the rows the caller has to write. */
  outcomes: { recipient: BulkRecipient; ok: boolean; error: string | null }[];
}

/**
 * Sends a campaign immediately, without relying on the queue columns.
 *
 * Used when `admin_email_recipients.status` does not exist yet. The
 * difference from `dispatchMessage` is only what happens to the overflow:
 * with no place to record "pending", recipients beyond this hour's capacity
 * are **not attempted at all** and reported back as deferred, rather than
 * being sent into a limit that would reject them. The administrator re-sends
 * those once capacity returns.
 *
 * Everything that prevents the original failure still applies here: Bcc
 * batching, the hourly cap, and stopping dead on the first throttle
 * rejection instead of attempting the rest.
 */
export async function sendCampaignDirect(
  recipients: readonly BulkRecipient[],
  payload: TransactionMessage,
  mode: DeliveryMode,
): Promise<DirectSendResult> {
  const perMessage = mode === "bcc" ? maxRecipientsPerMessage() : 1;
  const budget = await readBudget();

  // Only as many recipients as the hour can carry, under whichever of the
  // two ceilings binds first. Trimming up front is what keeps every recorded
  // row honest: each one was really attempted, and the rest are reported as
  // untouched rather than failed.
  const capacity = Math.min(
    Math.max(0, budget.remaining) * perMessage,
    Math.max(0, budget.recipientsRemaining),
  );
  const attempted = recipients.slice(0, capacity);

  const outcomes: DirectSendResult["outcomes"] = [];
  const batches = chunk(attempted, perMessage);
  const startedAt = Date.now();
  let sent = 0;
  let failed = 0;
  let messages = 0;
  let rateLimited = false;

  for (const batch of batches) {
    if (Date.now() - startedAt > MAX_RUN_MS) {
      // Out of time rather than out of allowance: the untried remainder is
      // deferred, not failed, for the same reason as above.
      break;
    }
    if (messages > 0) await new Promise((r) => setTimeout(r, GAP_MS));

    const result = await sendTransaction(batch, payload, mode);
    messages++;
    await recordTransaction(batch.length);

    if (result.ok) {
      sent += batch.length;
      for (const recipient of batch) outcomes.push({ recipient, ok: true, error: null });
      continue;
    }
    if (isRateLimitError(result.error)) {
      rateLimited = true;
      break;
    }
    failed += batch.length;
    for (const recipient of batch) {
      outcomes.push({ recipient, ok: false, error: result.error });
    }
  }

  const after = await readBudget();
  const untried = recipients.length - sent - failed;
  return {
    sent,
    failed,
    deferred: untried,
    messages,
    rateLimited,
    resetsAt: untried > 0 ? after.resetsAt : null,
    deliveryMode: mode,
    outcomes,
  };
}
