"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { Avatar } from "@/components/chat/Avatar";
import { useAvatarController } from "./avatar/useAvatarController";
import { useRealtimeAssistant, type AssistantStatus } from "./useRealtimeAssistant";

/** Her portrait: one still image, used both full-size and as the chat avatar. */
const PORTRAIT = "/chatbot.png";

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
 * The assistant chat: one modal with her portrait on one side and the
 * conversation on the other.
 *
 * The portrait is a still image - no 3D renderer - so the page stays light
 * and the panel looks the same on every device. Voice is unchanged: press the
 * mic and talk; the moment you stop, the mic mutes itself and she answers
 * aloud, her words appearing in the thread as she says them. Typing is the
 * fallback.
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
  const { status, messages, liveCaption, error, lastLatencyMs, startListening, stopListening, sendText, clear, close } =
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
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="研究アシスタント"
        // End-of-speech -> first reply audio, for monitoring response speed.
        data-reply-latency-ms={lastLatencyMs ?? undefined}
        onClick={(e) => e.stopPropagation()}
        className="flex h-[min(92dvh,46rem)] w-[min(60rem,100%)] flex-col overflow-hidden rounded-3xl bg-surface-1 shadow-[0_24px_64px_-16px_rgba(15,23,42,0.45)] ring-1 ring-line/70"
      >
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line/70 px-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <Image
              src={PORTRAIT}
              alt=""
              width={72}
              height={72}
              className="h-9 w-9 shrink-0 rounded-full object-cover object-top"
              priority
            />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[14px] font-semibold text-ink">研究アシスタント</p>
              <p className="flex items-center gap-1.5 truncate text-[11.5px] text-ink-3" aria-live="polite">
                <span
                  aria-hidden
                  className={cx(
                    "h-1.5 w-1.5 rounded-full transition-colors duration-500",
                    listening ? "bg-rose-500" : status === "connecting" ? "bg-amber-400" : "bg-emerald-500",
                  )}
                />
                {STATUS_LABEL[status]}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <IconButton label="会話を消去" icon="trash" onClick={() => { clear(); setDraft(""); }} />
            <IconButton label="閉じる" icon="x" onClick={onClose} />
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Portrait: still image, with the mic control resting on it */}
          <div className="relative h-[42%] shrink-0 overflow-hidden bg-surface-2 md:h-auto md:w-[40%]">
            <Image
              src={PORTRAIT}
              alt="研究アシスタント"
              fill
              sizes="(min-width: 768px) 24rem, 100vw"
              className="object-cover object-top"
              priority
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-slate-900/55 to-transparent"
            />
            <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 px-5 pb-5">
              {(liveCaption || listening) && (
                <p
                  aria-live="polite"
                  className="line-clamp-2 max-w-full rounded-2xl bg-slate-900/60 px-3.5 py-1.5 text-center text-[13px] leading-relaxed text-white backdrop-blur-sm"
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
                  "relative grid h-14 w-14 place-items-center rounded-full text-white shadow-lg ring-1 ring-white/30 transition duration-200 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100",
                  listening ? "bg-rose-500" : "bg-accent",
                )}
              >
                {listening && (
                  <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-rose-500/40 [animation-duration:1.8s]" />
                )}
                {busy ? <TypingDots light /> : <Icon name={listening ? "stop" : "mic"} className="relative h-6 w-6" />}
              </button>
            </div>
          </div>

          {/* Conversation */}
          <div className="flex min-h-0 flex-1 flex-col border-line/70 bg-surface-0 md:border-l">
            <div ref={listRef} className="shell-scroll min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 py-5 sm:px-6">
              {visible.length === 0 && !busy && (
                <div className="grid h-full place-items-center px-6 text-center">
                  <p className="text-[13px] leading-relaxed text-ink-3">
                    マイクを押して話しかけてください
                  </p>
                </div>
              )}
              {visible.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex flex-row-reverse items-end gap-2.5">
                    <ViewerAvatar viewer={viewer} />
                    <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-accent px-4 py-2.5 text-[14px] leading-relaxed text-accent-contrast">
                      {m.content === "…" ? <TypingDots light /> : m.content}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="flex items-end gap-2.5">
                    <AssistantAvatar />
                    <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-surface-1 px-4 py-2.5 text-[14px] leading-relaxed text-ink ring-1 ring-line/70">
                      {m.content}
                    </div>
                  </div>
                ),
              )}
              {busy && visible.at(-1)?.role !== "assistant" && (
                <div className="flex items-end gap-2.5" aria-label="応答を準備中">
                  <AssistantAvatar />
                  <div className="rounded-2xl rounded-bl-sm bg-surface-1 px-4 py-3 ring-1 ring-line/70">
                    <TypingDots />
                  </div>
                </div>
              )}
              {error && <p className="px-2 text-center text-[12px] leading-relaxed text-danger">{error}</p>}
            </div>

            <form
              className="shrink-0 border-t border-line/70 px-4 py-3 sm:px-6"
              onSubmit={(e) => {
                e.preventDefault();
                const text = draft;
                setDraft("");
                void sendText(text);
              }}
            >
              <div className="flex items-center gap-2 rounded-full bg-surface-1 py-1.5 pl-4 pr-1.5 ring-1 ring-line transition focus-within:ring-2 focus-within:ring-accent/50">
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
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-accent-contrast transition hover:opacity-90 disabled:opacity-30"
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

function IconButton({ label, icon, onClick }: { label: string; icon: "trash" | "x"; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid h-9 w-9 place-items-center rounded-full text-ink-3 transition hover:bg-surface-2 hover:text-ink"
    >
      <Icon name={icon} className="h-4 w-4" />
    </button>
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

function AssistantAvatar() {
  return (
    <Image
      src={PORTRAIT}
      alt=""
      width={64}
      height={64}
      className="h-8 w-8 shrink-0 rounded-full object-cover object-top ring-1 ring-line/70"
    />
  );
}

function ViewerAvatar({ viewer }: { viewer: ChatViewer }) {
  if (viewer.signedIn) {
    return (
      <Avatar name={viewer.name ?? "?"} avatarUrl={viewer.avatarUrl} size={32} className="rounded-full ring-1 ring-line/70" />
    );
  }
  // Guests: a neutral default avatar.
  return (
    <span
      aria-hidden
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-3 ring-1 ring-line/70"
    >
      <Icon name="user" className="h-4 w-4" />
    </span>
  );
}
