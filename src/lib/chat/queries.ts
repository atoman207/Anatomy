import "server-only";

import { createAdminSupabase, createServerSupabase } from "@/lib/supabase/server";
import type { ChannelSummary, ChatMessage, DmConversationSummary, LabMemberOption } from "./types";
import { CHAT_ATTACHMENTS_BUCKET, CHAT_ATTACHMENT_SIGNED_URL_TTL_SECONDS, sortDmPair } from "./shared";

const DEFAULT_CHANNEL_NAME = "general";

type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;

/**
 * Inserts the default "general" channel for a freshly created lab.
 *
 * Called right after the lab and its owner's `lab_members` row exist, from
 * both `createLabAction` and `ensurePersonalLab`. Runs on the admin client
 * (the caller already holds the appropriate authority - `is_lab_owner`
 * would also pass RLS at this point, but the admin client avoids a second
 * round trip through auth). A failure here is logged and swallowed rather
 * than rolled back: a lab with no default channel is a much smaller problem
 * than a lab creation that silently fails.
 */
export async function ensureGeneralChannel(labId: string, ownerId: string): Promise<void> {
  try {
    const admin = createAdminSupabase();
    await admin
      .from("channels")
      .insert({ lab_id: labId, name: DEFAULT_CHANNEL_NAME, created_by: ownerId })
      .select("id")
      .single();
  } catch {
    // Best-effort - see the doc comment above.
  }
}

/**
 * Every channel the viewer can see in this lab - public channels plus any
 * private channel they're a member of. `channels_select` RLS already
 * enforces exactly that filter, so the session-scoped client returns the
 * right set with no extra filtering needed here.
 */
export async function listChannelsForLab(labId: string): Promise<ChannelSummary[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("channels")
    .select("id, lab_id, name, topic, created_by, archived_at, is_private")
    .eq("lab_id", labId)
    .order("name", { ascending: true });
  return (data ?? []).map((c) => ({
    id: c.id,
    labId: c.lab_id,
    name: c.name,
    topic: c.topic,
    createdBy: c.created_by,
    archived: c.archived_at !== null,
    isPrivate: c.is_private,
  }));
}

export async function getChannel(channelId: string): Promise<ChannelSummary | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("channels")
    .select("id, lab_id, name, topic, created_by, archived_at, is_private")
    .eq("id", channelId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    labId: data.lab_id,
    name: data.name,
    topic: data.topic,
    createdBy: data.created_by,
    archived: data.archived_at !== null,
    isPrivate: data.is_private,
  };
}

/** Current members of a (usually private) channel, for the manage-members panel. */
export async function listChannelMembers(channelId: string): Promise<LabMemberOption[]> {
  const supabase = await createServerSupabase();
  const { data: rows } = await supabase
    .from("channel_members")
    .select("user_id")
    .eq("channel_id", channelId);
  const ids = (rows ?? []).map((r) => r.user_id);
  if (ids.length === 0) return [];

  const admin = createAdminSupabase();
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, display_name, email, avatar_url")
    .in("id", ids);
  return (profiles ?? []).map((p) => ({
    userId: p.id,
    displayName: p.display_name?.trim() || "ユーザー",
    email: p.email ?? "",
    avatarUrl: p.avatar_url,
  }));
}

/**
 * DM conversations the viewer is part of within one lab, with the other
 * party's identity resolved.
 *
 * `profiles` select policy is `id = auth.uid() or is_platform_admin()` -
 * an ordinary member cannot read anyone else's row through the
 * session-scoped client, so every profile lookup below for a user who
 * isn't the viewer goes through the admin client instead, the same way
 * `/labs/page.tsx`'s member roster already has to.
 */
export async function listDmConversationsForLab(
  labId: string,
  viewerId: string,
): Promise<DmConversationSummary[]> {
  const supabase = await createServerSupabase();
  const { data: rows } = await supabase
    .from("dm_conversations")
    .select("id, lab_id, user_a, user_b")
    .eq("lab_id", labId);
  const conversations = rows ?? [];
  if (conversations.length === 0) return [];

  const otherIds = [
    ...new Set(conversations.map((c) => (c.user_a === viewerId ? c.user_b : c.user_a))),
  ];
  const admin = createAdminSupabase();
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, display_name, email, avatar_url")
    .in("id", otherIds);
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  return conversations.map((c) => {
    const otherId = c.user_a === viewerId ? c.user_b : c.user_a;
    const profile = profileById.get(otherId);
    return {
      id: c.id,
      labId: c.lab_id,
      otherUserId: otherId,
      otherDisplayName: profile?.display_name?.trim() || "（不明なユーザー）",
      otherEmail: profile?.email ?? "",
      otherAvatarUrl: profile?.avatar_url ?? null,
    };
  });
}

async function attachmentSignedUrl(
  supabase: ServerSupabase,
  path: string | null,
): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .createSignedUrl(path, CHAT_ATTACHMENT_SIGNED_URL_TTL_SECONDS);
  return data?.signedUrl ?? null;
}

interface MessageParent {
  channelId?: string;
  dmConversationId?: string;
}

/** The most recent messages for a channel or DM, oldest first (ready to render top-to-bottom). */
export async function listRecentMessages(
  parent: MessageParent,
  limit = 50,
): Promise<ChatMessage[]> {
  const supabase = await createServerSupabase();
  let query = supabase
    .from("messages")
    .select("id, lab_id, channel_id, dm_conversation_id, sender_id, body, attachment_path, attachment_name, attachment_mime, edited_at, deleted_at, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  query = parent.channelId
    ? query.eq("channel_id", parent.channelId)
    : query.eq("dm_conversation_id", parent.dmConversationId!);

  const { data } = await query;
  const rows = (data ?? []).slice().reverse();
  if (rows.length === 0) return [];

  const senderIds = [...new Set(rows.map((r) => r.sender_id).filter((id): id is string => !!id))];
  const admin = createAdminSupabase();
  const { data: profiles } = senderIds.length
    ? await admin.from("profiles").select("id, display_name, avatar_url").in("id", senderIds)
    : { data: [] as { id: string; display_name: string | null; avatar_url: string | null }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name?.trim() || "unknown"]));
  const avatarById = new Map((profiles ?? []).map((p) => [p.id, p.avatar_url]));

  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      labId: r.lab_id,
      channelId: r.channel_id,
      dmConversationId: r.dm_conversation_id,
      senderId: r.sender_id,
      senderDisplayName: r.sender_id ? nameById.get(r.sender_id) ?? "unknown" : "unknown",
      senderAvatarUrl: r.sender_id ? avatarById.get(r.sender_id) ?? null : null,
      body: r.deleted_at ? null : r.body,
      attachmentPath: r.deleted_at ? null : r.attachment_path,
      attachmentName: r.deleted_at ? null : r.attachment_name,
      attachmentMime: r.deleted_at ? null : r.attachment_mime,
      attachmentUrl: r.deleted_at ? null : await attachmentSignedUrl(supabase, r.attachment_path),
      editedAt: r.edited_at,
      deleted: r.deleted_at !== null,
      createdAt: r.created_at,
    })),
  );
}

/** Every other member of a lab, for the "start a DM" picker. */
export async function listLabMembersForPicker(
  labId: string,
  viewerId: string,
): Promise<LabMemberOption[]> {
  const supabase = await createServerSupabase();
  const { data: members } = await supabase
    .from("lab_members")
    .select("user_id")
    .eq("lab_id", labId)
    .neq("user_id", viewerId);
  const ids = (members ?? []).map((m) => m.user_id);
  if (ids.length === 0) return [];

  const admin = createAdminSupabase();
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, display_name, email, avatar_url")
    .in("id", ids);
  return (profiles ?? []).map((p) => ({
    userId: p.id,
    displayName: p.display_name?.trim() || "ユーザー",
    email: p.email ?? "",
    avatarUrl: p.avatar_url,
  }));
}

/** Finds an existing DM conversation between the viewer and another lab member, without creating one. */
export async function getOrFindDmConversation(
  labId: string,
  userA: string,
  userB: string,
): Promise<DmConversationSummary | null> {
  const [a, b] = sortDmPair(userA, userB);
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("dm_conversations")
    .select("id, lab_id, user_a, user_b")
    .eq("lab_id", labId)
    .eq("user_a", a)
    .eq("user_b", b)
    .maybeSingle();
  if (!data) return null;
  const otherId = data.user_a === userA ? data.user_b : data.user_a;
  const admin = createAdminSupabase();
  const { data: profile } = await admin
    .from("profiles")
    .select("display_name, email, avatar_url")
    .eq("id", otherId)
    .maybeSingle();
  return {
    id: data.id,
    labId: data.lab_id,
    otherUserId: otherId,
    otherDisplayName: profile?.display_name?.trim() || "（不明なユーザー）",
    otherEmail: profile?.email ?? "",
    otherAvatarUrl: profile?.avatar_url ?? null,
  };
}

/**
 * Unread chat messages per lab for the signed-in viewer.
 * Counts others' non-deleted messages newer than the viewer's read cursor
 * (or, if never opened, newer than when they joined the lab).
 */
export async function getUnreadCountsByLab(
  viewerId: string,
  labIds: string[],
): Promise<Record<string, number>> {
  const { byLab } = await loadUnreadBreakdown(viewerId, labIds);
  return byLab;
}

/** Unread counts for channels and DMs inside one lab (sidebar badges). */
export async function getConversationUnreadCounts(
  viewerId: string,
  labId: string,
): Promise<{ byChannel: Record<string, number>; byDm: Record<string, number> }> {
  const { byChannel, byDm } = await loadUnreadBreakdown(viewerId, [labId]);
  return { byChannel, byDm };
}

async function loadUnreadBreakdown(
  viewerId: string,
  labIds: string[],
): Promise<{
  byLab: Record<string, number>;
  byChannel: Record<string, number>;
  byDm: Record<string, number>;
}> {
  const empty = { byLab: {}, byChannel: {}, byDm: {} };
  if (labIds.length === 0) return empty;
  const supabase = await createServerSupabase();

  const [{ data: memberships, error: memError }, { data: reads, error: readError }, { data: messages, error: msgError }] =
    await Promise.all([
      supabase
        .from("lab_members")
        .select("lab_id, joined_at")
        .eq("user_id", viewerId)
        .in("lab_id", labIds),
      supabase
        .from("chat_conversation_reads")
        .select("lab_id, channel_id, dm_conversation_id, last_read_at")
        .eq("user_id", viewerId)
        .in("lab_id", labIds),
      supabase
        .from("messages")
        .select("lab_id, channel_id, dm_conversation_id, created_at")
        .neq("sender_id", viewerId)
        .is("deleted_at", null)
        .in("lab_id", labIds),
    ]);

  // Membership / messages are required. Read cursors are optional so badges
  // still work before that migration is applied (everything since join counts).
  if (memError || msgError) return empty;

  const joinedAtByLab = new Map(
    (memberships ?? []).map((m) => [m.lab_id, new Date(m.joined_at).getTime()] as const),
  );

  const readAtByConversation = new Map<string, number>();
  for (const r of readError ? [] : (reads ?? [])) {
    const key = r.channel_id
      ? `c:${r.channel_id}`
      : r.dm_conversation_id
        ? `d:${r.dm_conversation_id}`
        : null;
    if (!key) continue;
    readAtByConversation.set(key, new Date(r.last_read_at).getTime());
  }

  const byLab: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  const byDm: Record<string, number> = {};

  for (const m of messages ?? []) {
    const key = m.channel_id
      ? `c:${m.channel_id}`
      : m.dm_conversation_id
        ? `d:${m.dm_conversation_id}`
        : null;
    if (!key) continue;
    const created = new Date(m.created_at).getTime();
    const cutoff = readAtByConversation.get(key) ?? joinedAtByLab.get(m.lab_id) ?? 0;
    if (created <= cutoff) continue;
    byLab[m.lab_id] = (byLab[m.lab_id] ?? 0) + 1;
    if (m.channel_id) byChannel[m.channel_id] = (byChannel[m.channel_id] ?? 0) + 1;
    if (m.dm_conversation_id) byDm[m.dm_conversation_id] = (byDm[m.dm_conversation_id] ?? 0) + 1;
  }
  return { byLab, byChannel, byDm };
}
