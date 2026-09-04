"use server";

/**
 * The administrator mailer behind /admin/email.
 *
 * Platform-admin only, the same authority level as /admin/users: this sends
 * mail to other people's inboxes from the deployment's own mailbox, which is
 * a deployment-wide act rather than something a laboratory does for itself.
 *
 * Two rules shape everything below:
 *
 *   1. An address is never taken from the browser for an account. The client
 *      posts user *ids*; the address is re-read from `auth.users` here. A
 *      posted id can only ever redirect the message to a real account of this
 *      deployment, never to an arbitrary inbox. Typed-in addresses are the
 *      one exception, and they are exactly that - typed by the administrator.
 *   2. What was sent is recorded before it is sent. `admin_email_messages`
 *      gets its row first, so a crash partway through a broadcast still
 *      leaves evidence of what went out; per-address outcomes land in
 *      `admin_email_recipients` afterwards.
 *
 * `admin_email_*` have row-level security enabled with no client-facing
 * policy at all (see supabase/migrations/all.sql), so every read and write
 * here goes through the service-role client - the platform-admin check below
 * is what actually protects them.
 */

import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/server";
import { getSessionContext, logAudit } from "@/lib/auth/guards";
import {
  emailSenderAddress, isEmailConfigured, sendTransaction, usesPlaceholders,
  type BulkRecipient, type DeliveryMode,
} from "@/lib/email/smtp";
import { EMAIL_RE, htmlToText, parseAddressList } from "@/lib/email/compose";
import {
  dispatchMessage, readBudget, readEmailSchema, sendCampaignDirect, FROM_NAME,
  type DispatchResult,
} from "@/lib/email/campaign";
import {
  isRateLimitError, maxRecipientsPerMessage, messagesNeeded,
} from "@/lib/email/limits";
import type { AdminEmailMessageRow } from "@/lib/supabase/types";

export interface ActionResult {
  ok: boolean;
  message: string;
}

const fail = (message: string): ActionResult => ({ ok: false, message });
const done = (message: string): ActionResult => ({ ok: true, message });

const SUBJECT_MAX = 200;
const BODY_MAX = 20000;
/**
 * A ceiling on one campaign's recipient list.
 *
 * No longer a limit on what can be *delivered* - anything beyond the hour's
 * budget is queued and resumed, so a list this size completes over several
 * hours rather than failing. It is a sanity bound on a single paste, so a
 * runaway list is caught at the door instead of becoming a multi-day queue.
 */
const RECIPIENTS_MAX = 5000;

async function platformAdmin() {
  const ctx = await getSessionContext();
  if (!ctx) throw new Error("サインインしていません。");
  if (!ctx.isPlatformAdmin) throw new Error("システム管理者のみ利用できます。");
  return ctx;
}

/* ------------------------------------------------------------------ */
/* Audience                                                            */
/* ------------------------------------------------------------------ */

export interface EmailAudienceUser {
  id: string;
  email: string;
  displayName: string;
  confirmed: boolean;
  /** Laboratory names, for the composer's lab filter. */
  labs: string[];
}

export interface EmailAudience {
  users: EmailAudienceUser[];
  labs: string[];
  /** From address, or null when SMTP is not configured. */
  sender: string | null;
}

/** What the composer needs to explain the mailbox's limits before a send. */
export interface SendingCapacity {
  /** Messages allowed per trailing hour by the mailbox's plan. */
  messagesPerHour: number;
  /** Messages already spent in the current window. */
  messagesUsed: number;
  /** Messages still available right now. */
  messagesRemaining: number;
  /** Recipients that fit in one Bcc batch. */
  recipientsPerMessage: number;
  /** The independent per-hour ceiling on addresses reached. */
  recipientsPerHour: number;
  /** Addresses already reached in the current window. */
  recipientsUsed: number;
  /** Recipients reachable right now, under whichever ceiling binds first. */
  reachableNow: number;
  /** Recipients reachable in a fresh hour, under whichever ceiling binds. */
  reachablePerHour: number;
  /** When throttled capacity next frees up. */
  resetsAt: string | null;
  /** False until the rate-governor migration has been applied. */
  ledgerReady: boolean;
}

export async function loadSendingCapacity(): Promise<SendingCapacity> {
  await platformAdmin();
  const budget = await readBudget();
  const perMessage = maxRecipientsPerMessage();
  return {
    messagesPerHour: budget.perHour,
    messagesUsed: budget.used,
    messagesRemaining: budget.remaining,
    recipientsPerMessage: perMessage,
    recipientsPerHour: budget.recipientsPerHour,
    recipientsUsed: budget.recipientsUsed,
    // Two ceilings apply at once - messages and addresses - so what is
    // actually reachable is the lower of the two, not the message figure.
    reachableNow: Math.min(budget.remaining * perMessage, budget.recipientsRemaining),
    reachablePerHour: Math.min(budget.perHour * perMessage, budget.recipientsPerHour),
    resetsAt: budget.resetsAt,
    ledgerReady: budget.ledgerReady,
  };
}

/**
 * How this exact draft would be delivered - the composer shows it before the
 * send so "389 recipients" is never a surprise about what happens next.
 */
export async function estimateCampaign(
  recipientCount: number,
  subject: string,
  body: string,
): Promise<{
  mode: DeliveryMode;
  messages: number;
  fitsInCurrentWindow: boolean;
  capacity: SendingCapacity;
}> {
  const capacity = await loadSendingCapacity();
  const mode: DeliveryMode = usesPlaceholders(subject, body) ? "individual" : "bcc";
  const perMessage = mode === "bcc" ? capacity.recipientsPerMessage : 1;
  const messages = messagesNeeded(recipientCount, perMessage);
  return {
    mode,
    messages,
    fitsInCurrentWindow:
      messages <= capacity.messagesRemaining && recipientCount <= capacity.reachableNow,
    capacity,
  };
}

/** Every account that could receive mail, with what the composer filters on. */
export async function loadEmailAudience(): Promise<EmailAudience> {
  await platformAdmin();
  const admin = createAdminSupabase();

  const users: EmailAudienceUser[] = [];
  let page = 1;
  // listUsers is paginated; a lab-scale deployment will not exceed a few pages.
  while (page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    for (const u of data.users) {
      // No address, nothing to send to - such an account simply is not part
      // of the audience rather than a row that fails at send time.
      if (!u.email) continue;
      users.push({
        id: u.id,
        email: u.email,
        displayName:
          (u.user_metadata?.display_name as string | undefined) ?? u.email.split("@")[0],
        confirmed: Boolean(u.email_confirmed_at),
        labs: [],
      });
    }
    if (data.users.length < 200) break;
    page++;
  }

  // profiles.display_name is the authority where it is set; the auth metadata
  // above is the fallback for accounts that never edited their profile.
  const { data: profiles } = await admin.from("profiles").select("id, display_name");
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  const { data: memberships } = await admin
    .from("lab_members")
    .select("user_id, laboratories(name)");
  const labsByUser = new Map<string, string[]>();
  for (const m of memberships ?? []) {
    const embedded = m.laboratories as unknown;
    const lab = (Array.isArray(embedded) ? embedded[0] : embedded) as { name: string } | null;
    if (!lab) continue;
    labsByUser.set(m.user_id, [...(labsByUser.get(m.user_id) ?? []), lab.name]);
  }

  for (const u of users) {
    u.displayName = nameById.get(u.id) || u.displayName;
    u.labs = labsByUser.get(u.id) ?? [];
  }
  users.sort((a, b) => a.email.localeCompare(b.email));

  const labs = [...new Set(users.flatMap((u) => u.labs))].sort((a, b) => a.localeCompare(b));

  return { users, labs, sender: emailSenderAddress() };
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export interface SentEmailSummary {
  id: string;
  subject: string;
  audience: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  /** Recipients still queued because the hourly budget ran out. */
  pendingCount: number;
  /** SMTP transactions used - lower than the recipient count in bcc mode. */
  messageCount: number;
  deliveryMode: string;
  fromAddress: string;
  sentByEmail: string | null;
  createdAt: string;
  /** Addresses the SMTP server refused, with the reason it gave. */
  failures: { email: string; error: string | null }[];
}

/** The most recent broadcasts, newest first. */
export async function listSentEmails(limit = 20): Promise<SentEmailSummary[]> {
  await platformAdmin();
  const admin = createAdminSupabase();

  const { data: messages, error } = await admin
    .from("admin_email_messages")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  const rows = (messages ?? []) as AdminEmailMessageRow[];
  if (rows.length === 0) return [];

  // Only the failures are read back: a successful address adds nothing the
  // counts do not already say, and the list is long.
  const { data: failureRows } = await admin
    .from("admin_email_recipients")
    .select("message_id, email, error")
    .in("message_id", rows.map((m) => m.id))
    .eq("ok", false);
  const failuresByMessage = new Map<string, { email: string; error: string | null }[]>();
  for (const f of failureRows ?? []) {
    failuresByMessage.set(f.message_id, [
      ...(failuresByMessage.get(f.message_id) ?? []),
      { email: f.email, error: f.error },
    ]);
  }

  const senderIds = [...new Set(rows.map((m) => m.sent_by).filter((id): id is string => !!id))];
  const emailById = new Map<string, string>();
  if (senderIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, email")
      .in("id", senderIds);
    for (const p of profiles ?? []) emailById.set(p.id, p.email ?? "");
  }

  return rows.map((m) => ({
    id: m.id,
    subject: m.subject,
    audience: m.audience,
    recipientCount: m.recipient_count,
    pendingCount: m.pending_count ?? 0,
    messageCount: m.message_count ?? 0,
    deliveryMode: m.delivery_mode ?? "individual",
    sentCount: m.sent_count,
    failedCount: m.failed_count,
    fromAddress: m.from_address,
    sentByEmail: m.sent_by ? emailById.get(m.sent_by) ?? null : null,
    createdAt: m.created_at,
    failures: failuresByMessage.get(m.id) ?? [],
  }));
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

interface ComposedMessage {
  subject: string;
  body: string;
  format: "text" | "html";
  replyTo: string | null;
}

/** Reads and validates the parts of the form that describe the message itself. */
function readComposed(formData: FormData): ComposedMessage | string {
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const format = String(formData.get("body_format") ?? "text") === "html" ? "html" : "text";
  const replyToRaw = String(formData.get("reply_to") ?? "").trim().toLowerCase();

  if (!subject) return "件名を入力してください。";
  if (subject.length > SUBJECT_MAX) return `件名は${SUBJECT_MAX}文字以内で入力してください。`;
  if (!body) return "本文を入力してください。";
  if (body.length > BODY_MAX) return `本文は${BODY_MAX}文字以内で入力してください。`;
  if (replyToRaw && !EMAIL_RE.test(replyToRaw)) {
    return "返信先メールアドレスの形式が正しくありません。";
  }

  return { subject, body, format, replyTo: replyToRaw || null };
}

/**
 * Resolves the checked user ids and any typed-in addresses into one deduped
 * recipient list, reading every account's address from the database rather
 * than from the form.
 */
async function resolveRecipients(
  formData: FormData,
): Promise<{ recipients: BulkRecipient[]; audience: string } | string> {
  const userIds = formData
    .getAll("user_ids")
    .map((v) => String(v))
    .filter(Boolean);
  const manual = parseAddressList(String(formData.get("manual_emails") ?? ""));

  const invalid = manual.filter((e) => !EMAIL_RE.test(e));
  if (invalid.length > 0) {
    return `メールアドレスの形式が正しくありません: ${invalid.slice(0, 3).join(", ")}`;
  }

  const byEmail = new Map<string, BulkRecipient>();
  let totalAccounts = 0;

  if (userIds.length > 0) {
    const audience = await loadEmailAudience();
    totalAccounts = audience.users.length;
    const byId = new Map(audience.users.map((u) => [u.id, u]));
    for (const id of userIds) {
      const user = byId.get(id);
      // An id with no matching account is skipped rather than failing the
      // send: the list may simply be a page older than a just-deleted user.
      if (!user) continue;
      byEmail.set(user.email.toLowerCase(), {
        email: user.email,
        name: user.displayName,
        userId: user.id,
      });
    }
  }

  for (const email of manual) {
    if (byEmail.has(email)) continue;
    byEmail.set(email, { email, name: null, userId: null });
  }

  const recipients = [...byEmail.values()];
  if (recipients.length === 0) return "宛先を1件以上選択または入力してください。";
  if (recipients.length > RECIPIENTS_MAX) {
    return `一度に送信できる宛先は${RECIPIENTS_MAX}件までです（現在 ${recipients.length} 件）。`;
  }

  // Derived here rather than trusted from the form - it is a record of what
  // actually happened, so it should be read off the resolved list.
  const selectedAccounts = recipients.filter((r) => r.userId).length;
  const audience =
    selectedAccounts === 0
      ? "manual"
      : totalAccounts > 0 && selectedAccounts === totalAccounts
        ? "all"
        : "selected";

  return { recipients, audience };
}

/**
 * Composes and sends to everyone selected, then records the outcome.
 *
 * Returns a summary rather than throwing on a partial failure: a broadcast
 * where 48 of 50 addresses were accepted is not a failed action, and the two
 * that were refused are named in the history table.
 */
export async function sendAdminEmailAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await platformAdmin();

    if (!isEmailConfigured()) {
      return fail(
        "SMTPが設定されていません。SMTP_HOST / SMTP_USER / SMTP_PASSWORD を設定してください。",
      );
    }

    const composed = readComposed(formData);
    if (typeof composed === "string") return fail(composed);

    // The composer submits one form with two buttons; `mode` is the clicked
    // button's own value. A test send goes to the administrator alone, so
    // taking this from the browser can only ever narrow the audience.
    if (String(formData.get("mode") ?? "") === "test") {
      return await sendTest(ctx.user.id, ctx.email, ctx.displayName, composed);
    }

    const resolved = await resolveRecipients(formData);
    if (typeof resolved === "string") return fail(resolved);
    const { recipients, audience } = resolved;

    const fromAddress = emailSenderAddress() ?? "";
    const admin = createAdminSupabase();

    // Bcc batching is the only way a few hundred recipients fit inside the
    // mailbox's hourly message limit, so it is the default - but it sends one
    // body to a whole batch, which makes per-recipient substitution
    // impossible. A message that uses {{name}} therefore has to go one at a
    // time, and pays for it in throughput. The composer says which mode a
    // draft will use before it is sent.
    const mode: DeliveryMode = usesPlaceholders(composed.subject, composed.body)
      ? "individual"
      : "bcc";

    // The queue columns arrived in a later migration section. Without them a
    // campaign cannot be resumed, so it is sent directly and capped to what
    // the hour can carry - see sendCampaignDirect. Checked per send rather
    // than cached, because the migration can be applied while the server is
    // running and the better path should take effect immediately.
    const schema = await readEmailSchema();
    if (!schema.queue) {
      return await sendWithoutQueue(ctx.user.id, {
        composed, recipients, audience, mode, fromAddress,
      });
    }

    // Recorded before the first message goes out - see the note at the top.
    // Everything starts pending; delivery below moves rows out of that state.
    const { data: message, error: insertError } = await admin
      .from("admin_email_messages")
      .insert({
        subject: composed.subject,
        body: composed.body,
        body_format: composed.format,
        from_address: fromAddress,
        reply_to: composed.replyTo,
        audience,
        recipient_count: recipients.length,
        pending_count: recipients.length,
        delivery_mode: mode,
        status: "partial",
        sent_by: ctx.user.id,
      })
      .select("id")
      .single();
    if (insertError) return fail(insertError.message);

    const { error: recipientError } = await admin.from("admin_email_recipients").insert(
      recipients.map((r) => ({
        message_id: message.id,
        email: r.email,
        user_id: r.userId ?? null,
        display_name: r.name ?? null,
        status: "pending",
      })),
    );
    if (recipientError) return fail(recipientError.message);

    const result = await dispatchMessage(message.id);

    await logAudit({
      labId: null,
      userId: ctx.user.id,
      action: "email.sent",
      entity: "admin_email_message",
      entityId: message.id,
      detail: {
        subject: composed.subject,
        audience,
        recipients: recipients.length,
        delivery_mode: result.deliveryMode,
        messages: result.messages,
        sent: result.sent,
        failed: result.failed,
        pending: result.pending,
        rate_limited: result.rateLimited,
      },
    });

    revalidatePath("/admin/email");
    return summarize(recipients.length, result);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "メールを送信できませんでした。");
  }
}

/**
 * Sends a campaign on a database that has no queue columns yet.
 *
 * Writes only the columns the original migration section created, so it works
 * before "rate-limit governor and resumable delivery" has been pasted in.
 * What it gives up is resuming: recipients beyond this hour's capacity are
 * not attempted, and the administrator is told how many to re-send later.
 * What it keeps is everything that prevents the mass-rejection failure -
 * Bcc batching, the hourly cap, and stopping on the first throttle.
 */
async function sendWithoutQueue(
  userId: string,
  input: {
    composed: ComposedMessage;
    recipients: BulkRecipient[];
    audience: string;
    mode: DeliveryMode;
    fromAddress: string;
  },
): Promise<ActionResult> {
  const { composed, recipients, audience, mode, fromAddress } = input;
  const admin = createAdminSupabase();

  const result = await sendCampaignDirect(
    recipients,
    {
      subject: composed.subject,
      text: composed.format === "html" ? htmlToText(composed.body) : composed.body,
      html: composed.format === "html" ? composed.body : undefined,
      replyTo: composed.replyTo ?? (fromAddress || undefined),
      fromName: FROM_NAME,
      unsubscribeMailto: composed.replyTo ?? (fromAddress || undefined),
    },
    mode,
  );

  const { data: message } = await admin
    .from("admin_email_messages")
    .insert({
      subject: composed.subject,
      body: composed.body,
      body_format: composed.format,
      from_address: fromAddress,
      reply_to: composed.replyTo,
      audience,
      recipient_count: recipients.length,
      sent_count: result.sent,
      failed_count: result.failed,
      sent_by: userId,
    })
    .select("id")
    .single();

  if (message && result.outcomes.length > 0) {
    await admin.from("admin_email_recipients").insert(
      result.outcomes.map((o) => ({
        message_id: message.id,
        email: o.recipient.email,
        user_id: o.recipient.userId ?? null,
        ok: o.ok,
        error: o.error,
      })),
    );
  }

  await logAudit({
    labId: null,
    userId,
    action: "email.sent",
    entity: "admin_email_message",
    entityId: message?.id ?? null,
    detail: {
      subject: composed.subject,
      audience,
      delivery_mode: result.deliveryMode,
      messages: result.messages,
      sent: result.sent,
      failed: result.failed,
      deferred: result.deferred,
      rate_limited: result.rateLimited,
      queue_available: false,
    },
  });

  revalidatePath("/admin/email");

  const deferredNote =
    result.deferred > 0
      ? `1時間の送信上限のため、${result.deferred} 件は送信していません（宛先は保持されています）。` +
        `${result.resetsAt ? `${new Date(result.resetsAt).toLocaleTimeString("ja-JP")} 以降に` : "時間をおいて"}` +
        "残りの宛先を選び直して再送してください。"
      : "";

  if (result.sent === 0 && result.failed === 0) {
    return fail(`送信上限に達しているため、まだ送信できていません。${deferredNote}`);
  }
  if (result.failed === 0) {
    return done(
      `${result.sent} 件に送信しました（${result.messages} 通に分割）。${deferredNote}`,
    );
  }
  return fail(
    `${result.sent} 件に送信し、${result.failed} 件は失敗しました。${deferredNote}` +
      "失敗した宛先は下の送信履歴で確認できます。",
  );
}

/** Turns a dispatch outcome into the one sentence the administrator sees. */
function summarize(requested: number, result: DispatchResult): ActionResult {
  const resumeNote = result.resetsAt
    ? `送信上限に達したため、残り ${result.pending} 件は待機中です。` +
      `${new Date(result.resetsAt).toLocaleTimeString("ja-JP")} 以降に「残りを送信」で続けられます。`
    : result.pending > 0
      ? `残り ${result.pending} 件は待機中です。「残りを送信」で続けられます。`
      : "";

  if (result.pending === 0 && result.failed === 0) {
    return done(
      requested === 1
        ? "メールを送信しました。"
        : `${result.sent} 件すべてに送信しました（${result.messages} 通に分割）。`,
    );
  }
  if (result.sent === 0 && result.failed === 0 && result.pending > 0) {
    return fail(
      `送信上限に達しているため、まだ送信できていません。${resumeNote}`,
    );
  }
  if (result.failed === 0) {
    return done(`${result.sent} 件に送信しました。${resumeNote}`);
  }
  return fail(
    `${result.sent} 件に送信し、${result.failed} 件は失敗しました。${resumeNote}` +
      "失敗した宛先は下の送信履歴で確認できます。",
  );
}

/**
 * Continues a campaign whose recipients did not all fit in the hour it was
 * started in.
 *
 * Separate from starting one, and deliberately re-entrant: it reads only
 * rows still marked pending, so clicking it twice cannot double-send.
 */
export async function resumeAdminEmailAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await platformAdmin();
    const messageId = String(formData.get("message_id") ?? "");
    if (!messageId) return fail("送信レコードが指定されていません。");

    if (!isEmailConfigured()) {
      return fail("SMTPが設定されていません。");
    }

    const result = await dispatchMessage(messageId);

    await logAudit({
      labId: null,
      userId: ctx.user.id,
      action: "email.resumed",
      entity: "admin_email_message",
      entityId: messageId,
      detail: {
        messages: result.messages,
        sent: result.sent,
        failed: result.failed,
        pending: result.pending,
        rate_limited: result.rateLimited,
      },
    });

    revalidatePath("/admin/email");

    if (result.sent === 0 && result.pending > 0) {
      const when = result.resetsAt
        ? `${new Date(result.resetsAt).toLocaleTimeString("ja-JP")} 以降に再度お試しください。`
        : "しばらく待ってから再度お試しください。";
      return fail(`まだ送信上限に達しています（残り ${result.pending} 件）。${when}`);
    }
    return summarize(result.sent + result.failed + result.pending, result);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "残りを送信できませんでした。");
  }
}

/**
 * Sends the composed message to the administrator's own address only.
 *
 * The recipient list is ignored entirely: this exists so the wording, the
 * `{{name}}` substitution and the HTML rendering can be checked in a real
 * mail client before anything reaches anyone else. Not recorded in
 * `admin_email_messages`, because it is not a broadcast.
 */
async function sendTest(
  userId: string,
  email: string,
  displayName: string,
  composed: ComposedMessage,
): Promise<ActionResult> {
  if (!email) return fail("あなたのアカウントにメールアドレスが設定されていません。");

  const self: BulkRecipient = { email, name: displayName, userId };
  const fromAddress = emailSenderAddress() ?? "";

  // Prefixed so a test can never be mistaken for the real broadcast in the
  // administrator's own inbox. Sent in individual mode so `{{name}}` is
  // substituted, which is half of what a test is for. It still costs one
  // message against the hourly budget, so it is logged like any other.
  const outcome = await sendTransaction(
    [self],
    {
      subject: `[テスト送信] ${composed.subject}`,
      text: composed.format === "html" ? htmlToText(composed.body) : composed.body,
      html: composed.format === "html" ? composed.body : undefined,
      replyTo: composed.replyTo ?? (fromAddress || undefined),
      fromName: FROM_NAME,
    },
    "individual",
  );

  await createAdminSupabase().from("admin_email_rate_log").insert({ recipients: 1 });

  if (!outcome.ok) {
    if (isRateLimitError(outcome.error)) {
      return fail(
        "送信上限に達しているため、テスト送信できません。" +
          "1時間あたりの送信可能数を超えています。時間をおいてお試しください。",
      );
    }
    return fail(`テスト送信に失敗しました: ${outcome.error}`);
  }
  return done(`${email} にテストメールを送信しました。本文と差し込みを確認してください。`);
}
