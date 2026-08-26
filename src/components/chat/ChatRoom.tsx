"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import {
  getPeerReadAtAction,
  markConversationReadAction,
  sendMessageAction,
} from "@/lib/chat/actions";
import {
  signChatAttachmentUrl,
  subscribeToConversationReads,
  subscribeToMessages,
  subscribeToTyping,
  type RealtimeMessageRow,
} from "@/lib/chat/realtime";
import type { MentionMember } from "@/lib/chat/mentions";
import { MessageList, type TypingUser } from "./MessageList";
import { MessageComposer, type ComposerAttachment } from "./MessageComposer";
import { useChatCall, type CallTarget } from "./CallContext";
import { ChannelMembersPanel } from "./ChannelMembersPanel";
import { UserProfilePanel, type ProfileUser } from "./UserProfilePanel";
import type { ChatMessage, KnownUser, LabMemberOption } from "@/lib/chat/types";

type Target = { channelId: string } | { dmConversationId: string };

function toChatMessage(row: RealtimeMessageRow, sender: KnownUser): ChatMessage {
  const deleted = row.deleted_at !== null;
  return {
    id: row.id,
    labId: row.lab_id,
    channelId: row.channel_id,
    dmConversationId: row.dm_conversation_id,
    senderId: row.sender_id,
    senderDisplayName: sender.displayName,
    senderAvatarUrl: sender.avatarUrl,
    body: deleted ? null : row.body,
    attachmentPath: deleted ? null : row.attachment_path,
    attachmentName: deleted ? null : row.attachment_name,
    attachmentMime: deleted ? null : row.attachment_mime,
    attachmentUrl: null,
    editedAt: row.edited_at,
    deleted,
    createdAt: row.created_at,
  };
}

export function ChatRoom({
  labId,
  target,
  conversationId,
  title,
  subtitle,
  initialMessages,
  viewerId,
  viewerDisplayName,
  viewerAvatarUrl,
  viewerEmail,
  canWrite,
  writeDisabledReason,
  knownUsers,
  dmOtherUserId,
  dmOtherProfile,
  isPrivateChannel,
  canManageChannel,
  channelMembers,
  pickableChannelMembers,
}: {
  labId: string;
  target: Target;
  conversationId: string;
  title: string;
  subtitle?: string;
  initialMessages: ChatMessage[];
  viewerId: string;
  viewerDisplayName: string;
  viewerAvatarUrl: string | null;
  viewerEmail?: string;
  canWrite: boolean;
  writeDisabledReason?: string;
  /** userId -> identity, for labelling messages that arrive over realtime. */
  knownUsers: Record<string, KnownUser>;
  /** Set only in DM mode - the other participant's id, needed to ring them when a call starts. */
  dmOtherUserId?: string;
  /** DM peer profile for the Slack-style right panel opened from the header name. */
  dmOtherProfile?: ProfileUser;
  /** Channel mode only - whether this channel is private, and who's in it. */
  isPrivateChannel?: boolean;
  canManageChannel?: boolean;
  channelMembers?: LabMemberOption[];
  pickableChannelMembers?: LabMemberOption[];
}) {
  const { startCall } = useChatCall();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [peerReadAt, setPeerReadAt] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [profileUser, setProfileUser] = useState<ProfileUser | null>(null);
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lastTypingSentAt = useRef(0);
  const isDm = "dmConversationId" in target;

  // Reset local state when the viewer switches conversations. This adjusts
  // state during render (React's sanctioned pattern for "derived state
  // depends on a changed prop") rather than in an effect, which would cause
  // an extra render showing the previous conversation's messages for one
  // frame before snapping to the new ones.
  const [renderedConversationId, setRenderedConversationId] = useState(conversationId);
  if (renderedConversationId !== conversationId) {
    setRenderedConversationId(conversationId);
    setMessages(initialMessages);
    setTypingUsers([]);
    setPeerReadAt(null);
    setProfileUser(null);
    setMembersOpen(false);
  }

  const openProfileForUserId = useCallback(
    (userId: string | null | undefined) => {
      if (!userId) return;
      if (userId === viewerId) {
        setProfileUser({
          userId: viewerId,
          displayName: viewerDisplayName,
          email: viewerEmail ?? "",
          avatarUrl: viewerAvatarUrl,
        });
        return;
      }
      if (dmOtherProfile && userId === dmOtherProfile.userId) {
        setProfileUser(dmOtherProfile);
        return;
      }
      const known = knownUsers[userId];
      if (!known) return;
      setProfileUser({
        userId,
        displayName: known.displayName,
        email: known.email ?? "",
        avatarUrl: known.avatarUrl,
      });
    },
    [viewerId, viewerDisplayName, viewerEmail, viewerAvatarUrl, dmOtherProfile, knownUsers],
  );

  const mentionMembers: MentionMember[] = useMemo(() => {
    const byId = new Map<string, MentionMember>();
    byId.set(viewerId, {
      userId: viewerId,
      displayName: viewerDisplayName,
      avatarUrl: viewerAvatarUrl,
    });

    // DMs: only the two participants. Channels: private roster or full lab.
    if (dmOtherProfile) {
      byId.set(dmOtherProfile.userId, {
        userId: dmOtherProfile.userId,
        displayName: dmOtherProfile.displayName,
        avatarUrl: dmOtherProfile.avatarUrl,
      });
      return [...byId.values()];
    }

    const source: LabMemberOption[] =
      isPrivateChannel && channelMembers && channelMembers.length > 0
        ? channelMembers
        : Object.entries(knownUsers).map(([userId, u]) => ({
            userId,
            displayName: u.displayName,
            email: u.email ?? "",
            avatarUrl: u.avatarUrl,
          }));
    for (const m of source) {
      if (m.userId === viewerId) continue;
      byId.set(m.userId, {
        userId: m.userId,
        displayName: m.displayName,
        avatarUrl: m.avatarUrl,
      });
    }
    return [...byId.values()];
  }, [
    viewerId,
    viewerDisplayName,
    viewerAvatarUrl,
    knownUsers,
    isPrivateChannel,
    channelMembers,
    dmOtherProfile,
  ]);

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of mentionMembers) map.set(m.userId, m.displayName);
    return map;
  }, [mentionMembers]);

  const resolveSender = useCallback(
    (userId: string | null): KnownUser => {
      if (!userId) return { displayName: "unknown", avatarUrl: null };
      if (userId === viewerId) return { displayName: viewerDisplayName, avatarUrl: viewerAvatarUrl };
      return knownUsers[userId] ?? { displayName: "unknown", avatarUrl: null };
    },
    [knownUsers, viewerId, viewerDisplayName, viewerAvatarUrl],
  );

  const markRead = useCallback(() => {
    void markConversationReadAction({
      labId,
      channelId: "channelId" in target ? target.channelId : undefined,
      dmConversationId: "dmConversationId" in target ? target.dmConversationId : undefined,
    });
  }, [labId, target]);

  useEffect(() => {
    void getPeerReadAtAction({
      labId,
      channelId: "channelId" in target ? target.channelId : undefined,
      dmConversationId: "dmConversationId" in target ? target.dmConversationId : undefined,
    }).then((result) => {
      if (result.ok) setPeerReadAt(result.data?.lastReadAt ?? null);
    });
    markRead();
  }, [conversationId, labId, target, markRead]);

  useEffect(() => {
    const unsubscribe = subscribeToMessages(target, {
      onInsert: (row) => {
        // The sender's own optimistic row is already on screen; skip the
        // echo rather than reconciling ids, which avoids a whole class of
        // duplicate-message bugs at zero cost.
        if (row.sender_id === viewerId) return;
        const message = toChatMessage(row, resolveSender(row.sender_id));
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
        if (message.attachmentPath) {
          void signChatAttachmentUrl(message.attachmentPath).then((url) => {
            setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, attachmentUrl: url } : m)));
          });
        }
        markRead();
      },
      onUpdate: (row) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === row.id
              ? toChatMessage(row, { displayName: m.senderDisplayName, avatarUrl: m.senderAvatarUrl })
              : m,
          ),
        );
      },
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, viewerId, markRead]);

  useEffect(() => {
    return subscribeToConversationReads(target, {
      onChange: (row) => {
        if (row.user_id === viewerId) return;
        setPeerReadAt((prev) => {
          if (!prev) return row.last_read_at;
          return new Date(row.last_read_at).getTime() > new Date(prev).getTime()
            ? row.last_read_at
            : prev;
        });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, viewerId]);

  const notifyTypingRef = useRef<((self: {
    userId: string;
    displayName: string;
    avatarUrl: string | null;
  }) => void) | null>(null);

  useEffect(() => {
    const { stop, notifyTyping } = subscribeToTyping(target, (event) => {
      if (event.userId === viewerId) return;
      const avatarUrl =
        event.avatarUrl ?? knownUsers[event.userId]?.avatarUrl ?? null;
      setTypingUsers((prev) => {
        if (prev.some((u) => u.userId === event.userId)) return prev;
        return [
          ...prev,
          { userId: event.userId, displayName: event.displayName, avatarUrl },
        ];
      });
      const existing = typingTimers.current.get(event.userId);
      if (existing) clearTimeout(existing);
      typingTimers.current.set(
        event.userId,
        setTimeout(() => {
          setTypingUsers((prev) => prev.filter((u) => u.userId !== event.userId));
          typingTimers.current.delete(event.userId);
        }, 3000),
      );
    });
    notifyTypingRef.current = notifyTyping;
    const timers = typingTimers.current;
    return () => {
      stop();
      notifyTypingRef.current = null;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, knownUsers, viewerId]);

  const handleTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSentAt.current < 2000) return;
    lastTypingSentAt.current = now;
    notifyTypingRef.current?.({
      userId: viewerId,
      displayName: viewerDisplayName,
      avatarUrl: viewerAvatarUrl,
    });
  }, [viewerId, viewerDisplayName, viewerAvatarUrl]);

  const handleSubmit = useCallback(
    (body: string, attachment: ComposerAttachment | null) => {
      const optimisticId = `pending-${crypto.randomUUID()}`;
      const optimistic: ChatMessage = {
        id: optimisticId,
        labId,
        channelId: "channelId" in target ? target.channelId : null,
        dmConversationId: "dmConversationId" in target ? target.dmConversationId : null,
        senderId: viewerId,
        senderDisplayName: viewerDisplayName,
        senderAvatarUrl: viewerAvatarUrl,
        body: body || null,
        attachmentPath: attachment?.path ?? null,
        attachmentName: attachment?.name ?? null,
        attachmentMime: attachment?.mime ?? null,
        attachmentUrl: null,
        editedAt: null,
        deleted: false,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      if (attachment) {
        void signChatAttachmentUrl(attachment.path).then((url) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === optimisticId ? { ...m, attachmentUrl: url } : m)),
          );
        });
      }
      void sendMessageAction({
        labId,
        channelId: "channelId" in target ? target.channelId : undefined,
        dmConversationId: "dmConversationId" in target ? target.dmConversationId : undefined,
        body,
        attachmentPath: attachment?.path,
        attachmentName: attachment?.name,
        attachmentMime: attachment?.mime,
      }).then((result) => {
        if (!result.ok) {
          setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
          return;
        }
        const realId = result.data?.id;
        if (realId) {
          setMessages((prev) =>
            prev.map((m) => (m.id === optimisticId ? { ...m, id: realId } : m)),
          );
        }
      });
    },
    [labId, target, viewerId, viewerDisplayName, viewerAvatarUrl],
  );

  const callTarget: CallTarget =
    "channelId" in target
      ? { channelId: target.channelId, title }
      : { dmConversationId: target.dmConversationId, otherUserId: dmOtherUserId ?? "", title };

  return (
    <div className="relative flex h-full min-w-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
          <div className="min-w-0">
            {isDm ? (
              <button
                type="button"
                onClick={() => openProfileForUserId(dmOtherUserId)}
                className="truncate text-left text-[15px] font-bold text-ink hover:underline"
              >
                {title}
              </button>
            ) : (
              <h2 className="truncate text-[15px] font-bold text-ink">{title}</h2>
            )}
            {!isDm && subtitle && (
              <p className="truncate text-[11px] text-ink-3">{subtitle}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {isPrivateChannel && (
              <button
                type="button"
                aria-label="チャンネルメンバー"
                onClick={() => setMembersOpen((v) => !v)}
                className="flex items-center gap-1 rounded px-2 py-2 text-ink-3 hover:bg-surface-2 hover:text-ink"
              >
                <Icon name="lock" className="h-4 w-4" />
                <span className="text-[12px]">{channelMembers?.length ?? 0}</span>
              </button>
            )}
            <button
              type="button"
              aria-label="音声通話"
              onClick={() => startCall(callTarget, "audio")}
              className="rounded p-2 text-ink-3 hover:bg-surface-2 hover:text-ink"
            >
              <Icon name="phone" className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="ビデオ通話"
              onClick={() => startCall(callTarget, "video")}
              className="rounded p-2 text-ink-3 hover:bg-surface-2 hover:text-ink"
            >
              <Icon name="video" className="h-4 w-4" />
            </button>
          </div>
        </div>

        {membersOpen && isPrivateChannel && (
          <ChannelMembersPanel
            channelId={"channelId" in target ? target.channelId : ""}
            members={channelMembers ?? []}
            pickableMembers={pickableChannelMembers ?? []}
            canManage={!!canManageChannel}
            viewerId={viewerId}
            onClose={() => setMembersOpen(false)}
          />
        )}

        <MessageList
          messages={messages}
          viewerId={viewerId}
          peerReadAt={peerReadAt}
          typingUsers={typingUsers}
          mentionMembers={mentionMembers}
          nameById={nameById}
          onOpenProfile={openProfileForUserId}
        />

        <MessageComposer
          labId={labId}
          conversationId={conversationId}
          placeholder={`${title} にメッセージを送信`}
          disabledReason={canWrite ? undefined : writeDisabledReason}
          mentionMembers={mentionMembers}
          onSubmit={handleSubmit}
          onTyping={handleTyping}
        />
      </div>

      {profileUser && (
        <UserProfilePanel user={profileUser} onClose={() => setProfileUser(null)} />
      )}
    </div>
  );
}
