"use client";

import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { Icon } from "@/components/icons";
import { Avatar } from "./Avatar";
import { uploadChatAttachmentAction } from "@/lib/chat/actions";
import { MAX_CHAT_ATTACHMENT_BYTES } from "@/lib/chat/shared";
import {
  filterMentionMembers,
  findActiveMention,
  insertMention,
  serializeMentions,
  type MentionMember,
} from "@/lib/chat/mentions";

export interface ComposerAttachment {
  path: string;
  name: string;
  mime: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function MessageComposer({
  labId,
  conversationId,
  placeholder,
  disabledReason,
  mentionMembers = [],
  onSubmit,
  onTyping,
}: {
  labId: string;
  conversationId: string;
  placeholder: string;
  /** When set, writing is disabled (e.g. a viewer in a channel) and this explains why. */
  disabledReason?: string;
  /** Lab (or channel) members available for `@` autocomplete. */
  mentionMembers?: MentionMember[];
  onSubmit: (body: string, attachment: ComposerAttachment | null) => void;
  onTyping?: () => void;
}) {
  const [body, setBody] = useState("");
  const [attachment, setAttachment] = useState<ComposerAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const disabled = !!disabledReason;

  const activeMention = useMemo(
    () => findActiveMention(body, caret),
    [body, caret],
  );
  const mentionMatches = useMemo(
    () =>
      activeMention
        ? filterMentionMembers(mentionMembers, activeMention.query).slice(0, 8)
        : [],
    [activeMention, mentionMembers],
  );
  const mentionOpen = !!activeMention && mentionMatches.length > 0 && !mentionDismissed;

  // Resets the highlighted suggestion and dismissed flag whenever the @-query
  // changes, adjusted during render rather than in an effect - the same
  // "reset local state when a derived value changes" pattern as ChatSidebar's
  // seededForLab.
  const mentionKey = activeMention ? `${activeMention.atIndex}:${activeMention.query}` : null;
  const [seededMentionKey, setSeededMentionKey] = useState(mentionKey);
  if (mentionKey !== seededMentionKey) {
    setSeededMentionKey(mentionKey);
    setMentionIndex(0);
    setMentionDismissed(false);
  }

  const applyMention = (member: MentionMember) => {
    const next = insertMention(body, caret, member);
    setBody(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  };

  const send = () => {
    const trimmed = body.trim();
    if (!trimmed && !attachment) return;
    onSubmit(serializeMentions(trimmed, mentionMembers), attachment);
    setBody("");
    setAttachment(null);
    setCaret(0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const pick = mentionMatches[mentionIndex];
        if (pick) applyMention(pick);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionDismissed(true);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const onFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
      setError(`ファイルが大きすぎます（最大${(MAX_CHAT_ATTACHMENT_BYTES / 1024 ** 2).toFixed(0)}MB）。`);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const base64 = await fileToBase64(file);
      const result = await uploadChatAttachmentAction({
        labId, conversationId, filename: file.name, mimeType: file.type || "application/octet-stream", base64,
      });
      if (!result.ok || !result.data) {
        setError(result.error ?? "アップロードに失敗しました。");
        return;
      }
      setAttachment({ path: result.data.path, name: file.name, mime: file.type || "application/octet-stream" });
    } finally {
      setUploading(false);
    }
  };

  if (disabled) {
    return (
      <div className="border-t border-line px-4 py-3 text-[13px] text-ink-3">
        {disabledReason}
      </div>
    );
  }

  return (
    <div className="border-t border-line px-4 py-3">
      {error && <p className="mb-1.5 text-[12px] text-danger">{error}</p>}
      {attachment && (
        <div className="mb-1.5 flex items-center gap-2 rounded border border-line px-2 py-1 text-[12px] text-ink-3">
          <Icon name="attach" className="h-3.5 w-3.5" />
          <span className="truncate">{attachment.name}</span>
          <button type="button" onClick={() => setAttachment(null)} className="ml-auto text-ink-3 hover:text-ink">
            <Icon name="x" className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="relative">
        {mentionOpen && (
          <div
            role="listbox"
            aria-label="メンション"
            className="absolute bottom-full left-0 z-30 mb-1 max-h-56 w-full max-w-sm overflow-y-auto rounded-lg border border-line bg-surface-1 py-1 shadow-lg"
          >
            {mentionMatches.map((m, i) => (
              <button
                key={m.userId}
                type="button"
                role="option"
                aria-selected={i === mentionIndex}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyMention(m);
                }}
                className={
                  "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] " +
                  (i === mentionIndex ? "bg-accent-soft text-accent" : "text-ink hover:bg-surface-2")
                }
              >
                <Avatar name={m.displayName} avatarUrl={m.avatarUrl} size={22} className="rounded" />
                <span className="truncate font-medium">{m.displayName}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface-1 px-2.5 py-2 focus-within:border-accent">
          <button
            type="button"
            aria-label="ファイルを添付"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
          >
            <Icon name="attach" className="h-4 w-4" />
          </button>
          <input ref={fileInputRef} type="file" className="hidden" onChange={onFileChange} />
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setCaret(e.target.selectionStart);
              onTyping?.();
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onClick={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            rows={1}
            className="max-h-40 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-5 text-ink placeholder:text-ink-3 focus:outline-none"
          />
          <button
            type="button"
            aria-label="送信"
            disabled={uploading || (!body.trim() && !attachment)}
            onClick={send}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-accent transition-colors hover:bg-surface-2 disabled:opacity-30"
          >
            <Icon name="send" className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
