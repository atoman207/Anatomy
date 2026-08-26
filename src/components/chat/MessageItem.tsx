"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Avatar } from "./Avatar";
import { deleteMessageAction, editMessageAction } from "@/lib/chat/actions";
import {
  deserializeMentions,
  parseMessageParts,
  serializeMentions,
  type MentionMember,
} from "@/lib/chat/mentions";
import type { ChatMessage } from "@/lib/chat/types";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function isImage(mime: string | null): boolean {
  return !!mime && mime.startsWith("image/");
}

function DeliveryChecks({ status }: { status: "pending" | "sent" | "read" }) {
  if (status === "pending") return null;
  const color = status === "read" ? "text-[#53bdeb]" : "text-ink-3";
  return (
    <span className={`inline-flex items-center ${color}`} aria-label={status === "read" ? "既読" : "送信済み"}>
      <Icon name="check" className="h-3 w-3" strokeWidth={2.5} />
      {status === "read" && <Icon name="check" className="-ml-1.5 h-3 w-3" strokeWidth={2.5} />}
    </span>
  );
}

export function MessageItem({
  message,
  isOwn,
  showHeader,
  deliveryStatus = "sent",
  viewerId,
  mentionMembers = [],
  nameById,
  onOpenProfile,
}: {
  message: ChatMessage;
  isOwn: boolean;
  /** Consecutive messages from the same sender collapse - only the first shows the name/avatar. */
  showHeader: boolean;
  /** Own messages only: pending → sent (1 check) → read (2 checks). */
  deliveryStatus?: "pending" | "sent" | "read";
  viewerId: string;
  mentionMembers?: MentionMember[];
  nameById: Map<string, string>;
  onOpenProfile?: (userId: string | null | undefined) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() =>
    deserializeMentions(message.body ?? "", nameById),
  );
  const [busy, setBusy] = useState(false);

  const parts = useMemo(
    () => (message.body ? parseMessageParts(message.body, nameById, mentionMembers) : []),
    [message.body, nameById, mentionMembers],
  );

  return (
    <div
      className={
        "group flex gap-2 px-4 py-0.5 " +
        (isOwn ? "flex-row-reverse" : "flex-row") +
        (showHeader ? " mt-3" : "")
      }
    >
      <div className="flex w-9 shrink-0 flex-col items-center">
        {showHeader ? (
          <button
            type="button"
            aria-label={`${message.senderDisplayName} のプロフィール`}
            onClick={() => onOpenProfile?.(message.senderId)}
            className="rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Avatar name={message.senderDisplayName} avatarUrl={message.senderAvatarUrl} size={36} />
          </button>
        ) : (
          <div className="h-9" aria-hidden />
        )}
      </div>

      <div className={"flex min-w-0 max-w-[min(75%,28rem)] flex-col " + (isOwn ? "items-end" : "items-start")}>
        {showHeader && !isOwn && (
          <button
            type="button"
            onClick={() => onOpenProfile?.(message.senderId)}
            className="mb-0.5 px-1 text-left text-[12px] font-semibold text-ink-2 hover:underline"
          >
            {message.senderDisplayName}
          </button>
        )}

        {message.deleted ? (
          <p className="px-1 text-[13px] italic text-ink-3">（このメッセージは削除されました）</p>
        ) : editing ? (
          <form
            className="flex w-full flex-col gap-1.5"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const result = await editMessageAction(
                message.id,
                serializeMentions(draft, mentionMembers),
              );
              setBusy(false);
              if (result.ok) setEditing(false);
            }}
          >
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              className="rounded-lg border border-line-strong bg-surface-1 px-2 py-1 text-[14px] text-ink focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <div className="flex gap-2 text-[12px]">
              <button type="submit" disabled={busy} className="font-medium text-accent">
                保存
              </button>
              <button type="button" onClick={() => setEditing(false)} className="text-ink-3">
                取消
              </button>
            </div>
          </form>
        ) : (
          <div
            className={
              "chat-bubble relative " +
              (isOwn ? "chat-bubble-own" : "chat-bubble-other")
            }
          >
            {message.body && (
              <p className="whitespace-pre-wrap break-words text-[14px] leading-snug text-ink">
                {parts.map((part, i) =>
                  part.type === "text" ? (
                    <span key={i}>{part.text}</span>
                  ) : (
                    <button
                      key={i}
                      type="button"
                      className={
                        "chat-mention " +
                        (part.userId === viewerId ? "chat-mention-self" : "")
                      }
                      onClick={() => onOpenProfile?.(part.userId || null)}
                    >
                      @{part.displayName}
                    </button>
                  ),
                )}
                {message.editedAt && (
                  <span className="ml-1.5 text-[11px] text-ink-3">（編集済み）</span>
                )}
              </p>
            )}
            {message.attachmentUrl && (
              <div className="mt-1.5 max-w-sm">
                {isImage(message.attachmentMime) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={message.attachmentUrl}
                    alt={message.attachmentName ?? "添付画像"}
                    className="max-h-72 rounded-md"
                  />
                ) : (
                  <a
                    href={message.attachmentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-md border border-line/60 bg-surface-1/50 px-3 py-2 text-[13px] text-accent hover:underline"
                  >
                    <Icon name="attach" className="h-4 w-4 shrink-0" />
                    <span className="truncate">{message.attachmentName ?? "添付ファイル"}</span>
                  </a>
                )}
              </div>
            )}
            <div className={"mt-1 flex items-center gap-1 " + (isOwn ? "justify-end" : "justify-start")}>
              <span className="text-[10px] leading-none text-ink-3">{formatTime(message.createdAt)}</span>
              {isOwn && <DeliveryChecks status={deliveryStatus} />}
            </div>
          </div>
        )}
      </div>

      {isOwn && !message.deleted && !editing && (
        <div className="hidden shrink-0 items-start gap-1 self-center group-hover:flex">
          <button
            type="button"
            aria-label="編集"
            onClick={() => {
              setDraft(deserializeMentions(message.body ?? "", nameById));
              setEditing(true);
            }}
            className="rounded border border-line bg-surface-1 p-1 text-ink-3 hover:text-ink"
          >
            <Icon name="edit" className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="削除"
            onClick={() => deleteMessageAction(message.id)}
            className="rounded border border-line bg-surface-1 p-1 text-ink-3 hover:text-danger"
          >
            <Icon name="trash" className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
