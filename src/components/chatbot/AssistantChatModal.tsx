"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { Avatar } from "@/components/chat/Avatar";
import { useAvatarController } from "./avatar/useAvatarController";
import { AssistantAvatarStage } from "./AssistantAvatarStage";
import { useRealtimeAssistant, type AssistantStatus } from "./useRealtimeAssistant";

export interface ChatViewer {
  signedIn: boolean;
  name: string | null;
  avatarUrl: string | null;
}

const STATUS_LABEL: Record<AssistantStatus, string> = {
  idle: "オンライン",
  connecting: "接続しています",
  ready: "オンライン",
  listening: "聞いています",
  thinking: "考えています",
  speaking: "話しています",
};

/**
 * The single assistant chat: one modal, the 3D assistant on one side and the
 * conversation on the other.
 *
 * Voice flow (realtime speech-to-speech): press the mic and talk -> the moment
 * you stop, the mic mutes itself and she answers aloud within about a second,
 * her words appearing in the thread as she says them. Press the mic again for
 * the next question. Typing remains as a fallback.
 */
export function AssistantChatModal({
  open,
  onClose,
  fallbackLabId,
  historyScope,
  viewer,
}: {
  open: boolean;
  onClose: () => void;
  fallbackLabId: string | null;
  historyScope: string;
  viewer: ChatViewer;
}) {
  const avatar = useAvatarController();
  const { status, messages, liveCaption, error, lastLatencyMs, lipSync, startListening, stopListening, sendText, clear, close } =
    useRealtimeAssistant({ labId: fallbackLabId, historyScope, avatar });
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Closing ends the live session (mic released, usage stops).
  useEffect(() => {
    if (!open) close();
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, liveCaption]);

  if (!open) return null;

  const listening = status === "listening";
  const busy = status === "connecting" || status === "thinking";
  const visible = messages.filter((m) => m.content.trim());

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 p-2 backdrop-blur-sm sm:p-5"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="研究アシスタント"
        // End-of-speech -> first reply audio, for monitoring response speed.
        data-reply-latency-ms={lastLatencyMs ?? undefined}
        onClick={(e) => e.stopPropagation()}
        className="flex h-[min(94dvh,52rem)] w-[min(66rem,100%)] flex-col overflow-hidden rounded-[26px] bg-surface-1 shadow-[0_30px_80px_-20px_rgba(15,23,42,0.55)] ring-1 ring-black/5"
      >
        {/* Title bar, always on top */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line/70 px-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden
              className={cx(
                "h-2.5 w-2.5 rounded-full transition-colors duration-500",
                listening ? "bg-rose-500" : status === "connecting" ? "bg-amber-400" : "bg-emerald-500",
              )}
            />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[14px] font-semibold tracking-wide text-ink">研究アシスタント</p>
              <p className="truncate text-[11.5px] text-ink-3" aria-live="polite">
                {STATUS_LABEL[status]}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="会話を消去"
              title="会話を消去"
              onClick={() => {
                clear();
                setDraft("");
              }}
              className="grid h-9 w-9 place-items-center rounded-full text-ink-3 transition hover:bg-surface-2 hover:text-ink"
            >
              <Icon name="trash" className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="閉じる"
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-full text-ink-3 transition hover:bg-surface-2 hover:text-ink"
            >
              <Icon name="x" className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* The assistant: seated at her laboratory desk (3D) */}
          <div className="relative h-[54%] shrink-0 overflow-hidden md:h-auto md:w-[44%]">
            <AssistantAvatarStage
              lipSync={lipSync}
              speaking={status === "speaking"}
              avatar={avatar}
              framing="body"
              showStatus={false}
              bare
              setting="lab"
              className="absolute inset-0"
            />
            <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 px-5 pb-5">
              {(liveCaption || listening) && (
                <p
                  aria-live="polite"
                  className="max-w-full rounded-2xl bg-slate-900/70 px-3.5 py-1.5 text-center text-[13px] leading-relaxed text-white backdrop-blur-md line-clamp-2"
                >
                  {liveCaption || "どうぞ、お話しください"}
                </p>
              )}
              <button
                type="button"
                onClick={() => void (listening ? stopListening() : startListening())}
                disabled={busy}
                aria-pressed={listening}
                aria-label={listening ? "話し終える" : "マイクで話しかける"}
                className={cx(
                  "relative grid h-16 w-16 place-items-center rounded-full text-white shadow-[0_10px_30px_-6px_rgba(15,23,42,0.45)] transition-transform duration-300 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100",
                  listening
                    ? "bg-gradient-to-br from-rose-500 to-rose-600"
                    : "bg-gradient-to-br from-indigo-500 to-blue-600",
                )}
              >
                {listening && (
                  <>
                    <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-rose-500/35 [animation-duration:1.6s]" />
                    <span aria-hidden className="absolute -inset-2 rounded-full ring-2 ring-rose-300/60" />
                  </>
                )}
                {busy ? (
                  <TypingDots light />
                ) : (
                  <Icon name={listening ? "stop" : "mic"} className="relative h-7 w-7" />
                )}
              </button>
            </div>
          </div>

          {/* The conversation */}
          <div className="flex min-h-0 flex-1 flex-col border-line/70 bg-gradient-to-b from-surface-0 to-surface-1 md:border-l">
            <div ref={listRef} className="shell-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
              {visible.length === 0 && status !== "thinking" && (
                <div className="grid h-full place-items-center">
                  <p className="text-[13px] text-ink-3">マイクを押して話しかけてください</p>
                </div>
              )}
              {visible.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex flex-row-reverse items-end gap-2.5">
                    <ViewerAvatar viewer={viewer} />
                    <div className="max-w-[78%] rounded-2xl rounded-br-md bg-gradient-to-br from-indigo-500 to-blue-600 px-4 py-2.5 text-[14px] leading-relaxed text-white shadow-sm">
                      {m.content === "…" ? <TypingDots light /> : m.content}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="flex items-end gap-2.5">
                    <AssistantBadge />
                    <div className="max-w-[78%] rounded-2xl rounded-bl-md bg-surface-1 px-4 py-2.5 text-[14px] leading-relaxed text-ink shadow-sm ring-1 ring-line/80">
                      {m.content}
                    </div>
                  </div>
                ),
              )}
              {status === "thinking" && visible.at(-1)?.role !== "assistant" && (
                <div className="flex items-end gap-2.5" aria-label="応答を準備中">
                  <AssistantBadge />
                  <div className="rounded-2xl rounded-bl-md bg-surface-1 px-4 py-3 shadow-sm ring-1 ring-line/80">
                    <TypingDots />
                  </div>
                </div>
              )}
              {error && <p className="text-center text-[12px] text-danger">{error}</p>}
            </div>

            <form
              className="shrink-0 px-4 pb-4 pt-2 sm:px-6"
              onSubmit={(e) => {
                e.preventDefault();
                const text = draft;
                setDraft("");
                void sendText(text);
              }}
            >
              <div className="flex items-center gap-2 rounded-full bg-surface-1 py-1.5 pl-4 pr-1.5 shadow-sm ring-1 ring-line transition focus-within:ring-2 focus-within:ring-accent/60">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="メッセージを入力"
                  aria-label="メッセージを入力"
                  className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
                />
                <button
                  type="submit"
                  aria-label="送信"
                  disabled={busy || !draft.trim()}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 text-white transition disabled:opacity-35"
                >
                  <Icon name="send" className="h-4 w-4" />
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}

function TypingDots({ light = false }: { light?: boolean }) {
  return (
    <span className="flex gap-1 py-0.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cx("h-1.5 w-1.5 animate-bounce rounded-full", light ? "bg-white/85" : "bg-ink-3")}
          style={{ animationDelay: `${i * 140}ms` }}
        />
      ))}
    </span>
  );
}

function AssistantBadge() {
  return (
    <span
      aria-hidden
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-100 to-indigo-100 text-[11px] font-bold text-indigo-600 ring-2 ring-white"
    >
      AI
    </span>
  );
}

function ViewerAvatar({ viewer }: { viewer: ChatViewer }) {
  if (viewer.signedIn) {
    return (
      <Avatar
        name={viewer.name ?? "?"}
        avatarUrl={viewer.avatarUrl}
        size={32}
        className="rounded-full ring-2 ring-white"
      />
    );
  }
  // Guests: a neutral default avatar.
  return (
    <span
      aria-hidden
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-slate-200 to-slate-300 text-slate-500 ring-2 ring-white"
    >
      <Icon name="user" className="h-4 w-4" />
    </span>
  );
}
