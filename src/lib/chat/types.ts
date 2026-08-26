import type { LabRole } from "@/lib/supabase/types";

/** A channel in the sidebar, with enough detail to render it without another query. */
export interface ChannelSummary {
  id: string;
  labId: string;
  name: string;
  topic: string | null;
  createdBy: string | null;
  archived: boolean;
  isPrivate: boolean;
}

export interface LabMemberOption {
  userId: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
}

/** A DM conversation in the sidebar - the other participant's identity, pre-resolved. */
export interface DmConversationSummary {
  id: string;
  labId: string;
  otherUserId: string;
  otherDisplayName: string;
  otherEmail: string;
  otherAvatarUrl: string | null;
}

/** One chat message, ready to render - `deleted` messages keep their row but blank the body. */
export interface ChatMessage {
  id: string;
  labId: string;
  channelId: string | null;
  dmConversationId: string | null;
  senderId: string | null;
  senderDisplayName: string;
  senderAvatarUrl: string | null;
  body: string | null;
  attachmentPath: string | null;
  attachmentName: string | null;
  attachmentMime: string | null;
  attachmentUrl: string | null;
  editedAt: string | null;
  deleted: boolean;
  createdAt: string;
}

/** Enough to render a lab member's identity - looked up when a realtime message names a sender by id. */
export interface KnownUser {
  displayName: string;
  avatarUrl: string | null;
  email?: string | null;
}

export type CallKind = "audio" | "video";

export interface CallSummary {
  id: string;
  labId: string;
  channelId: string | null;
  dmConversationId: string | null;
  kind: CallKind;
  startedBy: string | null;
  startedAt: string;
  ended: boolean;
  participantCount: number;
}

/** What the chat UI needs to know about the viewer's own standing in a lab. */
export interface ChatViewerContext {
  userId: string;
  labId: string;
  role: LabRole;
  canWrite: boolean;
  isOwner: boolean;
  canManage: boolean;
}
