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
 */

import { createAdminSupabase } from "@/lib/supabase/server";
import {
  chunk, isRateLimitError, isTransientError, maxMessagesPerHour,
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

export interface RateBudget {
  /** Transactions allowed per trailing hour (the plan's limit). */
  perHour: number;
  /** Transactions already used inside the current window. */
  used: number;
  /** Transactions still available right now. */
  remaining: number;
  /**
   * When the oldest in-window transaction ages out, freeing capacity again.
   * Null when nothing has been sent in the last hour.
   */
  resetsAt: string | null;
  /**
   * False when `admin_email_rate_log` is not there yet - the migration has
   * not been applied. Reported rather than swallowed: with no ledger the
   * budget cannot be enforced, and sending anyway is precisely the mistake
   * that earned 369 rejections. The caller shows a "run the migration"
   * message instead of a misleading "you are rate limited".
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
  const admin = createAdminSupabase();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from("admin_email_rate_log")
    .select("sent_at")
    .gte("sent_at", since)
    .order("sent_at", { ascending: true });

  // A missing table (migration not applied yet) must not claim a full
  // allowance - that is the failure mode this whole module exists to avoid.
  if (error) {
    return { perHour, used: perHour, remaining: 0, resetsAt: null, ledgerReady: false };
  }

  const rows = data ?? [];
  const used = rows.length;
  const oldest = rows[0]?.sent_at ?? null;
  return {
    perHour,
    used,
    remaining: Math.max(0, perHour - used),
    resetsAt: oldest ? new Date(new Date(oldest).getTime() + 60 * 60 * 1000).toISOString() : null,
    ledgerReady: true,
  };
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

  for (const batch of batches) {
    if (usedBudget >= budget.perHour) break;
    if (Date.now() - startedAt > MAX_RUN_MS) break;
    if (messages > 0 && GAP_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, GAP_MS));
    }

    const result = await sendTransaction(batch.map((b) => b.recipient), payload, mode);
    messages++;
    usedBudget++;

    // Logged whether or not it succeeded: a rejected attempt still counted
    // against the mailbox as far as the provider is concerned, and treating
    // it as free is how a throttled sender keeps digging.
    await admin
      .from("admin_email_rate_log")
      .insert({ message_id: messageId, recipients: batch.length });

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
