"use server";

import { revalidatePath } from "next/cache";
import { createAdminSupabase, createServerSupabase } from "@/lib/supabase/server";
import {
  assertCanManageLab, getSessionContext, logAudit,
} from "@/lib/auth/guards";
import {
  CHAT_ATTACHMENTS_BUCKET, CHAT_ATTACHMENT_SIGNED_URL_TTL_SECONDS, MAX_CALL_PARTICIPANTS,
  MAX_CHAT_ATTACHMENT_BYTES, MAX_MESSAGE_BODY_LENGTH, sortDmPair,
} from "./shared";
import type { CallKind } from "./types";

/**
 * Lab chat: channels, DMs, messages, calls.
 *
 * Two result shapes, matching the two existing conventions in this codebase:
 * - `FormActionResult` (`{ok, message}`) for the channel CRUD forms, which
 *   go through `ActionForm`/`InlineActionForm` exactly like every other
 *   admin-style mutation (see `src/lib/labs/actions.ts`).
 * - `ActionResult<T>` (`{ok, error?, data?}`) for everything called directly
 *   from a client component instead of a `<form>` - messages, DMs, calls -
 *   matching `src/lib/submissionFiles/actions.ts`'s shape, since these need
 *   to hand back data (a new message's id, a conversation id, a call id).
 */

export interface FormActionResult {
  ok: boolean;
  message: string;
}
const formFail = (message: string): FormActionResult => ({ ok: false, message });
const formDone = (message: string): FormActionResult => ({ ok: true, message });

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

async function ctxOrThrow() {
  const ctx = await getSessionContext();
  if (!ctx) throw new Error("サインインしていません。");
  return ctx;
}

/* ------------------------------------------------------------------ */
/* Channels                                                            */
/* ------------------------------------------------------------------ */

/**
 * Creates a channel - public by default, or private when the "非公開" box
 * is checked, in which case any `invite_user_ids` values are added to
 * `channel_members` alongside the creator. Any lab owner or admin may
 * create a channel (loosened from owner-only: "the lab administrator"
 * covers both roles the same way `assertCanManageLab` does everywhere else
 * in this codebase).
 */
export async function createChannelAction(
  _prev: FormActionResult | null,
  formData: FormData,
): Promise<FormActionResult> {
  try {
    const ctx = await ctxOrThrow();
    const labId = String(formData.get("lab_id") ?? "");
    const name = String(formData.get("name") ?? "").trim().toLowerCase().replace(/\s+/g, "-");
    const topic = String(formData.get("topic") ?? "").trim() || null;
    const isPrivate = formData.get("is_private") === "on";
    const inviteUserIds = formData.getAll("invite_user_ids").map(String).filter(Boolean);
    if (!labId) return formFail("研究室が選択されていません。");
    if (!name) return formFail("チャンネル名を入力してください。");
    if (name.length > 80) return formFail("チャンネル名が長すぎます（最大80文字）。");
    await assertCanManageLab(ctx, labId);

    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("channels")
      .insert({ lab_id: labId, name, topic, created_by: ctx.user.id, is_private: isPrivate })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") return formFail(`チャンネル「${name}」はすでに存在します。`);
      return formFail(error.message);
    }

    if (isPrivate) {
      const memberIds = [...new Set([ctx.user.id, ...inviteUserIds])];
      const { error: memberError } = await admin
        .from("channel_members")
        .insert(memberIds.map((userId) => ({ channel_id: data.id, user_id: userId, added_by: ctx.user.id })));
      if (memberError) {
        // The channel itself was created successfully; a roster hiccup
        // should not be reported as a full failure, just left for the
        // creator to fix from the members panel.
        await logAudit({
          labId, userId: ctx.user.id, action: "channel.member_seed_failed",
          entity: "channel", entityId: data.id, detail: { error: memberError.message },
        });
      }
    }

    await logAudit({
      labId, userId: ctx.user.id, action: "channel.created",
      entity: "channel", entityId: data.id, detail: { name, is_private: isPrivate },
    });

    revalidatePath(`/chat/${labId}`, "layout");
    return formDone(`チャンネル「${name}」を作成しました。`);
  } catch (e) {
    return formFail(e instanceof Error ? e.message : "チャンネルを作成できませんでした。");
  }
}

/**
 * Adds a lab member to a private channel's roster. RLS
 * (`channel_members_insert`: the channel's creator or a lab admin) is the
 * real authority here, matching this file's usual posture for
 * session-scoped writes - a rejection surfaces as a plain Postgres error,
 * not a distinct permission message.
 */
export async function inviteToChannelAction(
  channelId: string,
  userId: string,
): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "サインインしていません。" };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("channel_members")
    .insert({ channel_id: channelId, user_id: userId, added_by: ctx.user.id });
  if (error) {
    if (error.code === "23505") return { ok: true }; // already a member
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Removes someone from a private channel - a manager removing another member, or a self-leave. */
export async function removeFromChannelAction(
  channelId: string,
  userId: string,
): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "サインインしていません。" };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("channel_members")
    .delete()
    .eq("channel_id", channelId)
    .eq("user_id", userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function renameChannelAction(
  _prev: FormActionResult | null,
  formData: FormData,
): Promise<FormActionResult> {
  try {
    const ctx = await ctxOrThrow();
    const labId = String(formData.get("lab_id") ?? "");
    const channelId = String(formData.get("channel_id") ?? "");
    const name = String(formData.get("name") ?? "").trim().toLowerCase().replace(/\s+/g, "-");
    const topic = String(formData.get("topic") ?? "").trim() || null;
    if (!labId || !channelId) return formFail("チャンネルが指定されていません。");
    if (!name) return formFail("チャンネル名を入力してください。");
    await assertCanManageLab(ctx, labId);

    const admin = createAdminSupabase();
    const { error } = await admin
      .from("channels")
      .update({ name, topic })
      .eq("id", channelId)
      .eq("lab_id", labId);
    if (error) {
      if (error.code === "23505") return formFail(`チャンネル「${name}」はすでに存在します。`);
      return formFail(error.message);
    }

    await logAudit({
      labId, userId: ctx.user.id, action: "channel.renamed",
      entity: "channel", entityId: channelId, detail: { name },
    });

    revalidatePath(`/chat/${labId}`, "layout");
    return formDone("チャンネル名を変更しました。");
  } catch (e) {
    return formFail(e instanceof Error ? e.message : "チャンネル名を変更できませんでした。");
  }
}

export async function archiveChannelAction(
  _prev: FormActionResult | null,
  formData: FormData,
): Promise<FormActionResult> {
  try {
    const ctx = await ctxOrThrow();
    const labId = String(formData.get("lab_id") ?? "");
    const channelId = String(formData.get("channel_id") ?? "");
    if (!labId || !channelId) return formFail("チャンネルが指定されていません。");
    await assertCanManageLab(ctx, labId);

    const admin = createAdminSupabase();
    const { error } = await admin
      .from("channels")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", channelId)
      .eq("lab_id", labId);
    if (error) return formFail(error.message);

    await logAudit({
      labId, userId: ctx.user.id, action: "channel.archived",
      entity: "channel", entityId: channelId, detail: {},
    });

    revalidatePath(`/chat/${labId}`, "layout");
    return formDone("チャンネルをアーカイブしました。");
  } catch (e) {
    return formFail(e instanceof Error ? e.message : "チャンネルをアーカイブできませんでした。");
  }
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export interface SendMessageInput {
  labId: string;
  channelId?: string;
  dmConversationId?: string;
  body: string;
  attachmentPath?: string;
  attachmentName?: string;
  attachmentMime?: string;
}

/**
 * Posts a message. Runs on the session-scoped client, not the admin one -
 * this is the highest-volume write in the whole feature, so RLS
 * (`messages_insert`) is the real authority, not this function's own
 * judgment: a channel post still needs `can_write_lab` (member+, not
 * viewer), a DM post only needs to be a participant.
 */
export async function sendMessageAction(input: SendMessageInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "サインインしていません。" };
  if (!input.channelId && !input.dmConversationId) {
    return { ok: false, error: "送信先が指定されていません。" };
  }
  const body = input.body.trim();
  if (!body && !input.attachmentPath) return { ok: false, error: "本文か添付ファイルが必要です。" };
  if (body.length > MAX_MESSAGE_BODY_LENGTH) {
    return { ok: false, error: `メッセージが長すぎます（最大${MAX_MESSAGE_BODY_LENGTH}文字）。` };
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("messages")
    .insert({
      lab_id: input.labId,
      channel_id: input.channelId ?? null,
      dm_conversation_id: input.dmConversationId ?? null,
      sender_id: ctx.user.id,
      body: body || null,
      attachment_path: input.attachmentPath ?? null,
      attachment_name: input.attachmentName ?? null,
      attachment_mime: input.attachmentMime ?? null,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { id: data.id } };
}

export async function editMessageAction(
  messageId: string,
  body: string,
): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "サインインしていません。" };
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "本文を入力してください。" };
  if (trimmed.length > MAX_MESSAGE_BODY_LENGTH) {
    return { ok: false, error: `メッセージが長すぎます（最大${MAX_MESSAGE_BODY_LENGTH}文字）。` };
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("messages")
    .update({ body: trimmed, edited_at: new Date().toISOString() })
    .eq("id", messageId)
    .eq("sender_id", ctx.user.id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "自分のメッセージのみ編集できます。" };
  return { ok: true };
}

/**
 * Soft-deletes a message: the row stays (so the thread doesn't gap), but
 * the content is scrubbed. `body` becomes `''` rather than `null` - the
 * table's check constraint requires at least one of body/attachment_path to
 * be non-null, and `''` is non-null while still rendering as empty; the
 * attachment reference is cleared outright.
 */
export async function deleteMessageAction(messageId: string): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "サインインしていません。" };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("messages")
    .update({
      deleted_at: new Date().toISOString(),
      body: "",
      attachment_path: null,
      attachment_name: null,
      attachment_mime: null,
    })
    .eq("id", messageId)
    .eq("sender_id", ctx.user.id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "自分のメッセージのみ削除できます。" };
  return { ok: true };
}

export interface MarkConversationReadInput {
  labId: string;
  channelId?: string;
  dmConversationId?: string;
}

/**
 * Advances the viewer's read cursor for a channel or DM. Other participants
 * use the max peer cursor to decide when an outgoing message shows two
 * checkmarks (read) instead of one (sent).
 */
export async function markConversationReadAction(
  input: MarkConversationReadInput,
): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "サインインしていません。" };
  if (!input.channelId && !input.dmConversationId) {
    return { ok: false, error: "会話が指定されていません。" };
  }

  const supabase = await createServerSupabase();
  const now = new Date().toISOString();

  let existingQuery = supabase
    .from("chat_conversation_reads")
    .select("id")
    .eq("user_id", ctx.user.id);
  existingQuery = input.channelId
    ? existingQuery.eq("channel_id", input.channelId)
    : existingQuery.eq("dm_conversation_id", input.dmConversationId!);
  const { data: existing, error: findError } = await existingQuery.maybeSingle();
  if (findError) return { ok: false, error: findError.message };

  if (existing) {
    const { error } = await supabase
      .from("chat_conversation_reads")
      .update({ last_read_at: now, updated_at: now })
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase.from("chat_conversation_reads").insert({
      lab_id: input.labId,
      user_id: ctx.user.id,
      channel_id: input.channelId ?? null,
      dm_conversation_id: input.dmConversationId ?? null,
      last_read_at: now,
      updated_at: now,
    });
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Max `last_read_at` among other participants in this conversation (for checkmarks). */
export async function getPeerReadAtAction(
  input: MarkConversationReadInput,
): Promise<ActionResult<{ lastReadAt: string | null }>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "サインインしていません。" };
  if (!input.channelId && !input.dmConversationId) {
    return { ok: false, error: "会話が指定されていません。" };
  }

  const supabase = await createServerSupabase();
  let query = supabase
    .from("chat_conversation_reads")
    .select("last_read_at")
    .neq("user_id", ctx.user.id)
    .order("last_read_at", { ascending: false })
    .limit(1);
  query = input.channelId
    ? query.eq("channel_id", input.channelId)
    : query.eq("dm_conversation_id", input.dmConversationId!);
  const { data, error } = await query.maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { lastReadAt: data?.last_read_at ?? null } };
}

/** Unread message totals keyed by lab id, for the chat lab-tab badges. */
export async function getUnreadCountsAction(
  labIds: string[],
): Promise<Record<string, number>> {
  const ctx = await getSessionContext();
  if (!ctx || labIds.length === 0) return {};
  const { getUnreadCountsByLab } = await import("./queries");
  return getUnreadCountsByLab(ctx.user.id, labIds);
}

/** Unread totals for channels / DMs in one lab (sidebar badges). */
export async function getConversationUnreadCountsAction(
  labId: string,
): Promise<{ byChannel: Record<string, number>; byDm: Record<string, number> }> {
  const empty = { byChannel: {}, byDm: {} };
  const ctx = await getSessionContext();
  if (!ctx || !labId) return empty;
  const { getConversationUnreadCounts } = await import("./queries");
  return getConversationUnreadCounts(ctx.user.id, labId);
}

export interface UploadChatAttachmentInput {
  labId: string;
  /** The channel or DM-conversation id this attachment will belong to. */
  conversationId: string;
  filename: string;
  mimeType: string;
  /** Base64-encoded file content, no `data:` prefix. */
  base64: string;
}

/** Uploads a chat attachment and returns a signed URL, mirroring uploadSubmissionFile's shape. */
export async function uploadChatAttachmentAction(
  input: UploadChatAttachmentInput,
): Promise<ActionResult<{ path: string; signedUrl: string }>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "サインインしていません。" };
  if (!input.labId || !input.conversationId) return { ok: false, error: "送信先が指定されていません。" };
  const filename = input.filename.trim();
  if (!filename) return { ok: false, error: "ファイル名がありません。" };

  const supabase = await createServerSupabase();
  const bytes = Buffer.from(input.base64, "base64");
  if (bytes.byteLength === 0) return { ok: false, error: "ファイルが空です。" };
  if (bytes.byteLength > MAX_CHAT_ATTACHMENT_BYTES) {
    return { ok: false, error: `ファイルが大きすぎます（最大${(MAX_CHAT_ATTACHMENT_BYTES / 1024 ** 2).toFixed(0)}MB）。` };
  }

  const storagePath = `${input.labId}/${input.conversationId}/${Date.now()}_${filename}`;
  const { error: uploadError } = await supabase.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .upload(storagePath, bytes, { contentType: input.mimeType, upsert: false });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { data: signed, error: signError } = await supabase.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .createSignedUrl(storagePath, CHAT_ATTACHMENT_SIGNED_URL_TTL_SECONDS);
  if (signError || !signed) {
    return { ok: false, error: signError?.message ?? "署名付きURLを作成できませんでした。" };
  }

  return { ok: true, data: { path: storagePath, signedUrl: signed.signedUrl } };
}

/* ------------------------------------------------------------------ */
/* DMs                                                                  */
/* ------------------------------------------------------------------ */

/** Finds or creates the DM conversation between the caller and another lab member. */
export async function getOrCreateDmConversationAction(
  labId: string,
  otherUserId: string,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "サインインしていません。" };
  if (!labId || !otherUserId) return { ok: false, error: "相手が指定されていません。" };
  if (otherUserId === ctx.user.id) return { ok: false, error: "自分自身とはDMできません。" };

  const [userA, userB] = sortDmPair(ctx.user.id, otherUserId);
  const supabase = await createServerSupabase();

  const { data: existing } = await supabase
    .from("dm_conversations")
    .select("id")
    .eq("lab_id", labId)
    .eq("user_a", userA)
    .eq("user_b", userB)
    .maybeSingle();
  if (existing) return { ok: true, data: { id: existing.id } };

  const { data: created, error } = await supabase
    .from("dm_conversations")
    .insert({ lab_id: labId, user_a: userA, user_b: userB })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { id: created.id } };
}

/* ------------------------------------------------------------------ */
/* Calls                                                                */
/* ------------------------------------------------------------------ */

export interface StartCallInput {
  labId: string;
  channelId?: string;
  dmConversationId?: string;
  kind: CallKind;
}

/**
 * Starts a call, or - if one is already in progress for this channel/DM -
 * hands back its id instead of creating a duplicate. A channel call behaves
 * like a Slack Huddle: several people can independently press "call" on the
 * same channel and land in the same room rather than each starting their
 * own. `joinCallAction` (below) is still what actually adds the caller as a
 * participant and enforces the size cap - this only resolves which call id
 * to join.
 */
export async function startOrJoinCallAction(
  input: StartCallInput,
): Promise<ActionResult<{ callId: string; created: boolean }>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "サインインしていません。" };
  if (!input.channelId && !input.dmConversationId) return { ok: false, error: "通話先が指定されていません。" };

  const supabase = await createServerSupabase();

  let existingQuery = supabase.from("calls").select("id").is("ended_at", null);
  existingQuery = input.channelId
    ? existingQuery.eq("channel_id", input.channelId)
    : existingQuery.eq("dm_conversation_id", input.dmConversationId!);
  const { data: existing } = await existingQuery.maybeSingle();
  if (existing) return { ok: true, data: { callId: existing.id, created: false } };

  const { data: call, error: callError } = await supabase
    .from("calls")
    .insert({
      lab_id: input.labId,
      channel_id: input.channelId ?? null,
      dm_conversation_id: input.dmConversationId ?? null,
      kind: input.kind,
      started_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (callError) return { ok: false, error: callError.message };

  return { ok: true, data: { callId: call.id, created: true } };
}

/**
 * Joins an existing call. Enforces `MAX_CALL_PARTICIPANTS` server-side - the
 * mesh WebRTC topology this call feature uses (every participant opens a
 * direct connection to every other) degrades badly well before that, so
 * this is a real guardrail, not just a UI suggestion.
 */
export async function joinCallAction(callId: string): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "サインインしていません。" };

  const supabase = await createServerSupabase();
  const { count } = await supabase
    .from("call_participants")
    .select("user_id", { count: "exact", head: true })
    .eq("call_id", callId)
    .is("left_at", null);
  if ((count ?? 0) >= MAX_CALL_PARTICIPANTS) {
    return {
      ok: false,
      error: `この通話はすでに${MAX_CALL_PARTICIPANTS}人が参加しており、これ以上参加できません。`,
    };
  }

  const { error } = await supabase
    .from("call_participants")
    .upsert({ call_id: callId, user_id: ctx.user.id, joined_at: new Date().toISOString(), left_at: null }, { onConflict: "call_id,user_id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function leaveCallAction(callId: string): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "サインインしていません。" };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("call_participants")
    .update({ left_at: new Date().toISOString() })
    .eq("call_id", callId)
    .eq("user_id", ctx.user.id);
  if (error) return { ok: false, error: error.message };

  const { count } = await supabase
    .from("call_participants")
    .select("user_id", { count: "exact", head: true })
    .eq("call_id", callId)
    .is("left_at", null);
  if ((count ?? 0) === 0) {
    await supabase.from("calls").update({ ended_at: new Date().toISOString() }).eq("id", callId);
  }
  return { ok: true };
}
