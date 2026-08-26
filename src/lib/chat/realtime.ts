"use client";

import { createClient } from "@/lib/supabase/client";
import { CHAT_ATTACHMENTS_BUCKET, CHAT_ATTACHMENT_SIGNED_URL_TTL_SECONDS } from "./shared";

/**
 * Client-side Supabase Realtime wrappers.
 *
 * `messages` durable delivery goes over Postgres Changes (the table is in
 * the `supabase_realtime` publication, see the migration); presence/typing
 * for a conversation and WebRTC call signaling are ephemeral Broadcast +
 * Presence channels that never touch the database.
 *
 * Postgres Changes needs one more thing beyond a cookie-authenticated
 * browser client: the Realtime WebSocket connection has its own JWT, set
 * via `supabase.realtime.setAuth(token)`, separate from the one the
 * `@supabase/ssr` cookie plumbing attaches to ordinary REST/storage calls.
 * Without it, Realtime's RLS check for every change event runs with no
 * `auth.uid()`, so `messages_select` (which is keyed on `auth.uid()`
 * through `is_lab_member`/`is_dm_participant`) silently matches nothing -
 * confirmed empirically: an authenticated subscription with no explicit
 * `setAuth` call never received a single event, while the identical
 * subscription with `setAuth` called first worked immediately. This is not
 * optional wiring for this app; every Postgres Changes subscription must
 * call `ensureRealtimeAuth` first.
 */

async function ensureRealtimeAuth(supabase: ReturnType<typeof createClient>): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) supabase.realtime.setAuth(data.session.access_token);
}

/** Raw shape of a row as Postgres Changes delivers it - snake_case, matching the DB. */
export interface RealtimeMessageRow {
  id: string;
  lab_id: string;
  channel_id: string | null;
  dm_conversation_id: string | null;
  sender_id: string | null;
  body: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

export type MessageParent = { channelId: string } | { dmConversationId: string };

function parentFilter(parent: MessageParent): { column: string; value: string } {
  return "channelId" in parent
    ? { column: "channel_id", value: parent.channelId }
    : { column: "dm_conversation_id", value: parent.dmConversationId };
}

/** Subscribes to new/edited/deleted messages for one channel or DM. Returns an unsubscribe function. */
export function subscribeToMessages(
  parent: MessageParent,
  handlers: {
    onInsert: (row: RealtimeMessageRow) => void;
    onUpdate: (row: RealtimeMessageRow) => void;
    onReady?: () => void;
  },
): () => void {
  const supabase = createClient();
  const { column, value } = parentFilter(parent);
  const topic = `messages:${column}:${value}`;

  let cancelled = false;
  let channel: ReturnType<typeof supabase.channel> | null = null;

  void ensureRealtimeAuth(supabase).then(() => {
    if (cancelled) return;
    channel = supabase
      .channel(topic)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `${column}=eq.${value}` },
        (payload) => handlers.onInsert(payload.new as unknown as RealtimeMessageRow),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `${column}=eq.${value}` },
        (payload) => handlers.onUpdate(payload.new as unknown as RealtimeMessageRow),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") handlers.onReady?.();
      });
  });

  return () => {
    cancelled = true;
    if (channel) void supabase.removeChannel(channel);
  };
}

/** Mints a fresh signed URL for a chat attachment, client-side, for messages that arrive via realtime. */
export async function signChatAttachmentUrl(path: string): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .createSignedUrl(path, CHAT_ATTACHMENT_SIGNED_URL_TTL_SECONDS);
  return data?.signedUrl ?? null;
}

export interface TypingEvent {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
}

/** Ephemeral typing-indicator broadcast for one conversation. */
export function subscribeToTyping(
  parent: MessageParent,
  onTyping: (event: TypingEvent) => void,
): { stop: () => void; notifyTyping: (self: TypingEvent) => void } {
  const supabase = createClient();
  const { column, value } = parentFilter(parent);
  const topic = `typing:${column}:${value}`;
  const channel = supabase.channel(topic, { config: { broadcast: { self: false } } });
  channel
    .on("broadcast", { event: "typing" }, (payload) => onTyping(payload.payload as TypingEvent))
    .subscribe();

  return {
    stop: () => void supabase.removeChannel(channel),
    notifyTyping: (self) => {
      void channel.send({ type: "broadcast", event: "typing", payload: self });
    },
  };
}

export interface RealtimeConversationReadRow {
  id: string;
  lab_id: string;
  user_id: string;
  channel_id: string | null;
  dm_conversation_id: string | null;
  last_read_at: string;
  updated_at: string;
}

/** Subscribes to peer read-cursor updates for one channel or DM. */
export function subscribeToConversationReads(
  parent: MessageParent,
  handlers: {
    onChange: (row: RealtimeConversationReadRow) => void;
  },
): () => void {
  const supabase = createClient();
  const { column, value } = parentFilter(parent);
  const topic = `reads:${column}:${value}`;

  let cancelled = false;
  let channel: ReturnType<typeof supabase.channel> | null = null;

  void ensureRealtimeAuth(supabase).then(() => {
    if (cancelled) return;
    channel = supabase
      .channel(topic)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_conversation_reads",
          filter: `${column}=eq.${value}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as unknown as RealtimeConversationReadRow | null;
          if (row) handlers.onChange(row);
        },
      )
      .subscribe();
  });

  return () => {
    cancelled = true;
    if (channel) void supabase.removeChannel(channel);
  };
}
