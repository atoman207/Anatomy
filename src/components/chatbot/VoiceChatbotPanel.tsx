"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import {
  EMPTY_TRANSCRIPT,
  SpeechSession,
  fullTranscript,
  isWebSpeechSupported,
  type TranscriptState,
} from "@/lib/voice/webSpeech";
import { useChatbotConversation } from "./useChatbotConversation";
import { useAssistantVoice } from "./useAssistantVoice";
import { AssistantAvatarStage } from "./AssistantAvatarStage";
import { useAvatarController } from "./avatar/useAvatarController";

const HELP_TIP =
  "マイクボタンを押して話し、もう一度押すと自動で送信されます。下の欄にテキストで質問することもできます。" +
  "白衣の研究アシスタントが LABNOTE の使い方や研究の疑問に日本語でお答えします。ログインしていなくても利用できます。" +
  "会話履歴はこのブラウザ内に保存され、ゴミ箱ボタンで消去できます。";

/**
 * Left floating voice chatbot: browser speech in, AI reply out (spoken + text).
 *
 * - `shell` — anchored beside the app shell (header/sidebar offsets).
 * - `modal` — centered overlay with dimmed backdrop (landing page).
 */
export function VoiceChatbotPanel({
  open,
  onClose,
  fallbackLabId,
  variant = "shell",
  emptyHint,
  showPersona = false,
  historyScope,
}: {
  open: boolean;
  onClose: () => void;
  fallbackLabId: string | null;
  variant?: "shell" | "modal";
  /** Overrides the default empty-state copy (e.g. guest messaging on `/`). */
  emptyHint?: string;
  /** Modal only: the talking video AI assistant on top, voice-first controls. */
  showPersona?: boolean;
  /** Local history partition: the account, or "guest". */
  historyScope?: string;
}) {
  const { messages, pending, error, labId, send, clear, setError } = useChatbotConversation(
    "voice",
    fallbackLabId,
    historyScope,
  );
  const avatar = useAvatarController();
  const { dispatch: avatarDispatch, userActivity: avatarUserActivity } = avatar;
  const {
    speak,
    prime: primeVoice,
    stop: stopSpeaking,
    speaking,
    lipSync,
  } = useAssistantVoice(labId, avatar);
  const [draft, setDraft] = useState("");
  const [listening, setListening] = useState(false);
  const [speechHint, setSpeechHint] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptState>(EMPTY_TRANSCRIPT);
  const [helpOpen, setHelpOpen] = useState(false);
  /** Between the second mic click and the engine flushing its last phrase. */
  const [finishing, setFinishing] = useState(false);
  const sessionRef = useRef<SpeechSession | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const speakReplies = true;
  const isModal = variant === "modal";
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Reset listening during render when the panel closes (same pattern as
  // AppShell's path-driven drawer reset) so we do not setState inside an effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open && listening) setListening(false);
    if (!open && helpOpen) setHelpOpen(false);
  }

  useEffect(() => {
    if (open) return;
    sessionRef.current?.dispose();
    sessionRef.current = null;
    stopSpeaking();
    avatarDispatch({ type: "RESET" });
  }, [avatarDispatch, open, stopSpeaking]);

  // Voice playback cleans itself up inside useAssistantVoice.
  useEffect(() => {
    return () => {
      sessionRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!open || !isModal) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        stopSpeaking();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, isModal, onClose, stopSpeaking]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  const stopListen = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setListening(false);
  }, []);

  const startListen = useCallback(() => {
    if (!isWebSpeechSupported()) {
      setSpeechHint("このブラウザは音声認識に対応していません。テキストで入力してください。");
      return;
    }
    setSpeechHint(null);
    setTranscript(EMPTY_TRANSCRIPT);
    setError(null);
    // Order matters: SPEAKING + USER_STARTED = INTERRUPTED, then audio stops.
    avatarDispatch({ type: "USER_STARTED" });
    stopSpeaking();
    const session = new SpeechSession(
      {
        onTranscript: (next) => {
          setTranscript(next);
          avatarUserActivity();
        },
        onError: (err) => {
          if (err.kind === "not-allowed") {
            setSpeechHint("マイクの権限が必要です。");
            setListening(false);
          } else if (!err.recoverable) {
            setSpeechHint(err.message);
          }
        },
        onStateChange: () => {},
        onDead: () => {
          setSpeechHint("音声認識を開始できませんでした。");
          setListening(false);
        },
      },
      { lang: "ja-JP" },
    );
    sessionRef.current = session;
    setListening(true);
    session.start();
  }, [avatarDispatch, avatarUserActivity, setError, stopSpeaking]);

  const submit = useCallback(
    async (raw: string) => {
      stopListen();
      const text = raw.trim();
      if (!text) return;
      // Unlock audio inside the user gesture; the reply arrives after an await.
      if (speakReplies) primeVoice();
      setDraft("");
      setTranscript(EMPTY_TRANSCRIPT);
      avatarDispatch({ type: "REQUEST_SENT" });
      const result = await send(text);
      if (!result) {
        avatarDispatch({ type: "REPLY_FAILED" });
        return;
      }
      if (speakReplies) void speak(result.reply, result.performance);
      else avatarDispatch({ type: "REPLY_FAILED" });
    },
    [avatarDispatch, primeVoice, send, speak, speakReplies, stopListen],
  );

  /**
   * Second mic click: stop recording, wait for the recognizer to deliver the
   * phrase still in flight, then send it and let the assistant answer aloud.
   */
  const stopListenAndSend = useCallback(async () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    setListening(false);
    if (!session) return;
    // Still inside the click: unlock audio now, the reply comes after awaits.
    if (speakReplies) primeVoice();
    setFinishing(true);
    try {
      const text = await session.finish();
      // Closed while the last phrase was flushing: the user walked away.
      if (!openRef.current) return;
      if (text) {
        await submit(text);
      } else {
        setTranscript(EMPTY_TRANSCRIPT);
        avatarDispatch({ type: "USER_STOPPED" });
        setSpeechHint("音声を聞き取れませんでした。もう一度マイクを押して話してください。");
      }
    } finally {
      setFinishing(false);
    }
  }, [avatarDispatch, primeVoice, speakReplies, submit]);

  const liveText = listening || finishing ? fullTranscript(transcript).trim() : "";
  const defaultEmptyHint =
    "マイクを押して話し、もう一度押すと送信されます。下の欄への入力でも、LABNOTE アシスタントに質問できます。";

  const panel = (
    <aside
      className={cx(
        "flex flex-col overflow-hidden rounded-xl border border-line bg-surface-1 shadow-[var(--shadow-md)]",
        isModal
          ? "relative z-[91] h-[min(90dvh,calc(100dvh-1.5rem))] w-[min(36rem,calc(100vw-1.5rem))] sm:h-[min(88dvh,calc(100dvh-3rem))] sm:w-[min(42rem,calc(100vw-2rem))]"
          : "fixed z-40 bottom-4 left-4 top-[calc(var(--header-height)+1rem)] w-[min(22rem,calc(100vw-5rem))] lg:left-[calc(var(--sidebar-current,0px)+1rem)] max-h-[min(40rem,calc(100dvh-var(--header-height)-5rem))]",
        !open && !isModal && "pointer-events-none",
      )}
      style={
        isModal
          ? undefined
          : { height: "min(40rem, calc(100dvh - var(--header-height) - 5rem))" }
      }
      aria-label="音声チャットボット"
      {...(isModal
        ? { role: "dialog" as const, "aria-modal": true as const }
        : { hidden: !open, "aria-hidden": !open })}
      onClick={isModal ? (e) => e.stopPropagation() : undefined}
    >
      {isModal && showPersona && (
        // The video AI assistant is the centrepiece: large, above the thread.
        <AssistantAvatarStage
          lipSync={lipSync}
          speaking={speaking}
          avatar={avatar}
          className="h-[42%] min-h-[12rem] max-h-[22rem] shrink-0 border-b border-line sm:h-[48%] sm:min-h-[16rem] sm:max-h-[28rem]"
        />
      )}
      <div className="flex min-h-0 flex-1 flex-col">
      <header
        className={cx(
          "flex shrink-0 items-center justify-between border-b border-line px-3",
          isModal ? "h-14" : "h-12",
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon name={showPersona ? "video" : "mic"} className="h-4 w-4 shrink-0 text-accent" />
          <p className="truncate text-[14px] font-bold text-ink">
            {showPersona ? "研究アシスタント（ビデオAI）" : "音声チャット"}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            icon="info"
            iconOnly
            aria-label="チャットボットについて"
            title="チャットボットについて"
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen((v) => !v)}
          />
          <Button
            variant="ghost"
            size="sm"
            icon="trash"
            iconOnly
            aria-label="履歴を消去"
            title="履歴を消去"
            onClick={() => {
              stopSpeaking();
              clear();
              setDraft("");
              setTranscript(EMPTY_TRANSCRIPT);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            icon="x"
            iconOnly
            aria-label="閉じる"
            onClick={() => {
              stopSpeaking();
              onClose();
            }}
          />
        </div>
      </header>

      {helpOpen && (
        <div
          role="note"
          className="shrink-0 border-b border-line bg-surface-2/80 px-3 py-2.5 text-[12px] leading-relaxed text-ink-2"
        >
          {HELP_TIP}
        </div>
      )}

      <div
        ref={listRef}
        className={cx(
          "shell-scroll flex-1 space-y-3 overflow-y-auto px-3 py-3",
          isModal && "min-h-0",
        )}
      >
        {messages.length === 0 && !pending && (
          <div className="flex gap-3">
            <p className="rounded-lg bg-surface-2/70 px-3 py-2 text-[12px] leading-relaxed text-ink-3">
              {emptyHint ?? defaultEmptyHint}
            </p>
          </div>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <div
              key={m.id}
              className="ml-auto max-w-[95%] rounded-lg bg-accent px-3 py-2 text-[13px] leading-relaxed text-accent-contrast"
            >
              {m.content}
            </div>
          ) : (
            <div key={m.id} className="mr-auto flex max-w-[95%] gap-2.5">
              <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] leading-relaxed text-ink">
                {m.content}
              </div>
            </div>
          ),
        )}
        {pending && (
          <p className="text-[12px] text-ink-3" aria-live="polite">
            応答を生成中…
          </p>
        )}
        {error && (
          <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger">
            {error}
          </p>
        )}
        {speechHint && (
          <p className="text-[12px] text-ink-3">{speechHint}</p>
        )}
      </div>

      <div className="shrink-0 border-t border-line p-3">
        {(listening || finishing) && (
          <p className="mb-2 flex items-center gap-1.5 text-[12px] text-ink-2" aria-live="polite">
            <span
              className={cx(
                "inline-block h-2 w-2 shrink-0 rounded-full bg-danger",
                listening && "animate-pulse",
              )}
              aria-hidden
            />
            {finishing ? "送信しています…" : "録音中… もう一度マイクを押すと送信します"}
          </p>
        )}
        {showPersona && (
          // Voice first: talk to the assistant; typing stays as a fallback.
          <Button
            variant={listening ? "danger" : "primary"}
            icon={listening ? "stop" : "mic"}
            aria-pressed={listening}
            disabled={pending || finishing}
            onClick={() => void (listening ? stopListenAndSend() : startListen())}
            className="mb-2 w-full justify-center rounded-full py-3 text-[15px]"
          >
            {listening
              ? "話し終えたら押して送信"
              : pending || finishing
                ? "アシスタントが考えています…"
                : "マイクを押して話しかける"}
          </Button>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={listening || finishing ? liveText || draft : draft}
            onChange={(e) => {
              if (!listening && !finishing) setDraft(e.target.value);
            }}
            readOnly={listening || finishing}
            rows={showPersona ? 1 : 2}
            placeholder={showPersona ? "文字で質問する場合はこちら…" : "質問を入力…"}
            className={cx(
              "flex-1 resize-none rounded-md border border-line bg-surface-0 px-2.5 py-2 text-[13px] text-ink outline-none focus:border-accent",
              showPersona ? "min-h-[2.25rem]" : "min-h-[2.75rem]",
            )}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (listening) void stopListenAndSend();
                else if (!finishing) void submit(draft);
              }
            }}
          />
          {!showPersona && (
            <Button
              variant={listening ? "danger" : "secondary"}
              size="sm"
              icon={listening ? "stop" : "mic"}
              iconOnly
              aria-label={listening ? "音声入力を停止して送信" : "音声入力を開始"}
              aria-pressed={listening}
              disabled={pending || finishing}
              onClick={() => void (listening ? stopListenAndSend() : startListen())}
            />
          )}
          <Button
            variant="primary"
            size="sm"
            icon="send"
            iconOnly
            aria-label="送信"
            disabled={pending || finishing || !(listening ? liveText : draft).trim()}
            onClick={() => void (listening ? stopListenAndSend() : submit(draft))}
          />
        </div>
      </div>
      </div>
    </aside>
  );

  if (isModal) {
    if (!open) return null;
    return (
      <div
        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 px-3 py-4 sm:px-4 sm:py-6"
        onClick={() => {
          stopSpeaking();
          onClose();
        }}
      >
        {panel}
      </div>
    );
  }

  return panel;
}
