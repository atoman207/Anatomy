"use client";

import { useEffect, useMemo, useRef } from "react";
import { MessageItem } from "./MessageItem";
import { Avatar } from "./Avatar";
import type { MentionMember } from "@/lib/chat/mentions";
import type { ChatMessage } from "@/lib/chat/types";

const GROUP_WINDOW_MS = 5 * 60 * 1000;

export type TypingUser = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
};

function SlackTypingDots({ label }: { label: string }) {
  return (
    <div
      className="chat-typing-bubble"
      role="status"
      aria-label={`${label} が入力中`}
    >
      <span className="chat-typing-dot" />
      <span className="chat-typing-dot" />
      <span className="chat-typing-dot" />
    </div>
  );
}

export function MessageList({
  messages,
  viewerId,
  peerReadAt,
  typingUsers = [],
  mentionMembers = [],
  nameById,
  onOpenProfile,
}: {
  messages: ChatMessage[];
  viewerId: string;
  /** ISO timestamp: own messages at-or-before this are treated as read by a peer. */
  peerReadAt: string | null;
  typingUsers?: TypingUser[];
  mentionMembers?: MentionMember[];
  nameById: Map<string, string>;
  onOpenProfile?: (userId: string | null | undefined) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const peerReadMs = peerReadAt ? new Date(peerReadAt).getTime() : 0;
  const members = useMemo(() => mentionMembers, [mentionMembers]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, typingUsers.length]);

  return (
    <div className="flex-1 overflow-y-auto py-2">
      {messages.length === 0 && typingUsers.length === 0 ? (
        <p className="px-4 py-6 text-[14px] text-ink-3">
          まだメッセージがありません。最初のメッセージを送ってみましょう。
        </p>
      ) : (
        messages.map((m, i) => {
          const prev = messages[i - 1];
          const showHeader =
            !prev ||
            prev.senderId !== m.senderId ||
            new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > GROUP_WINDOW_MS;
          const isOwn = m.senderId === viewerId;
          let deliveryStatus: "pending" | "sent" | "read" = "sent";
          if (isOwn) {
            if (m.id.startsWith("pending-")) deliveryStatus = "pending";
            else if (peerReadMs > 0 && new Date(m.createdAt).getTime() <= peerReadMs) {
              deliveryStatus = "read";
            } else {
              deliveryStatus = "sent";
            }
          }
          return (
            <MessageItem
              key={m.id}
              message={m}
              isOwn={isOwn}
              showHeader={showHeader}
              deliveryStatus={deliveryStatus}
              viewerId={viewerId}
              mentionMembers={members}
              nameById={nameById}
              onOpenProfile={onOpenProfile}
            />
          );
        })
      )}

      {typingUsers.map((user) => (
        <div key={`typing-${user.userId}`} className="mt-3 flex gap-2 px-4">
          <div className="flex w-9 shrink-0 flex-col items-center gap-1">
            <Avatar name={user.displayName} avatarUrl={user.avatarUrl} size={36} />
            <SlackTypingDots label={user.displayName} />
          </div>
        </div>
      ))}

      <div ref={bottomRef} />
    </div>
  );
}
