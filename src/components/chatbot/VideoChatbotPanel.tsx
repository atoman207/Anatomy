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
import { useAvatarController } from "./avatar/useAvatarController";
import { AssistantAvatarStage } from "./AssistantAvatarStage";

/**
 * Right floating video chatbot: local camera preview + voice/text conversation.
 */
export function VideoChatbotPanel({
  open,
  onClose,
  fallbackLabId,
  historyScope,
  emptyHint,
}: {
  open: boolean;
  onClose: () => void;
  fallbackLabId: string | null;
  /** Local history partition: the account, or "guest". */
  historyScope?: string;
  /** Overrides the default empty-state copy (e.g. guest messaging on `/`). */
  emptyHint?: string;
}) {
  const { messages, pending, error, labId, send, clear, setError } = useChatbotConversation(
    "video",
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
  /** Between the second mic click and the engine flushing its last phrase. */
  const [finishing, setFinishing] = useState(false);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  const [draft, setDraft] = useState("");
  const [listening, setListening] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraHint, setCameraHint] = useState<string | null>(null);
  const [speechHint, setSpeechHint] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptState>(EMPTY_TRANSCRIPT);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<SpeechSession | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = localStream;
  }, [localStream]);

  // Reset UI state during render when the panel closes; media teardown stays
  // in an effect (imperative browser APIs only).
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      if (listening) setListening(false);
      if (cameraOn) setCameraOn(false);
      if (localStream) setLocalStream(null);
    }
  }

  const releaseCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLocalStream(null);
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraHint(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      setLocalStream(stream);
      setCameraOn(true);
    } catch {
      setCameraHint("カメラの権限が必要です。ブラウザの設定を確認してください。");
      setCameraOn(false);
    }
  }, []);

  useEffect(() => {
    if (open) return;
    sessionRef.current?.dispose();
    sessionRef.current = null;
    stopSpeaking();
    avatarDispatch({ type: "RESET" });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, [avatarDispatch, open, stopSpeaking]);

  useEffect(() => {
    return () => {
      sessionRef.current?.dispose();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

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
      primeVoice();
      setDraft("");
      setTranscript(EMPTY_TRANSCRIPT);
      avatarDispatch({ type: "REQUEST_SENT" });
      const result = await send(text);
      if (!result) {
        avatarDispatch({ type: "REPLY_FAILED" });
        return;
      }
      void speak(result.reply, result.performance);
    },
    [avatarDispatch, primeVoice, send, speak, stopListen],
  );

  /** Second mic click: wait for the last phrase, then send it. */
  const stopListenAndSend = useCallback(async () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    setListening(false);
    if (!session) return;
    primeVoice();
    setFinishing(true);
    try {
      const text = await session.finish();
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
  }, [avatarDispatch, primeVoice, submit]);

  const liveText = listening || finishing ? fullTranscript(transcript).trim() : "";

  return (
    <aside
      hidden={!open}
      className={cx(
        "fixed z-40 flex w-[min(22rem,calc(100vw-5rem))] flex-col overflow-hidden rounded-xl border border-line bg-surface-1 shadow-[var(--shadow-md)]",
        "bottom-4 right-4 top-[calc(var(--header-height)+1rem)]",
        "max-h-[min(40rem,calc(100dvh-var(--header-height)-5rem))]",
        !open && "pointer-events-none",
      )}
      style={{ height: "min(40rem, calc(100dvh - var(--header-height) - 5rem))" }}
      aria-label="ビデオチャットボット"
      aria-hidden={!open}
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon name="video" className="h-4 w-4 shrink-0 text-accent" />
          <p className="truncate text-[14px] font-bold text-ink">ビデオチャット</p>
        </div>
        <div className="flex items-center gap-1">
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
              releaseCamera();
              onClose();
            }}
          />
        </div>
      </header>

      {/* Video call layout: the assistant fills the frame, your camera is picture-in-picture. */}
      <div className="relative mx-3 mt-3 aspect-[4/3] shrink-0 overflow-hidden rounded-lg bg-black/80">
        <AssistantAvatarStage
          lipSync={lipSync}
          speaking={speaking}
          avatar={avatar}
          className="absolute inset-0"
        />
        <div className="absolute right-1.5 top-1.5 aspect-video w-[34%] overflow-hidden rounded-md bg-black/80 ring-1 ring-white/30">
          {cameraOn && localStream ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full -scale-x-100 object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Icon name="videoOff" className="h-4 w-4 text-white/60" />
            </div>
          )}
          <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[10px] text-white">
            あなた
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-center gap-2 px-3 py-2">
        <Button
          variant={cameraOn ? "secondary" : "primary"}
          size="sm"
          icon={cameraOn ? "videoOff" : "video"}
          onClick={() => void (cameraOn ? releaseCamera() : startCamera())}
        >
          {cameraOn ? "カメラオフ" : "カメラオン"}
        </Button>
      </div>
      {cameraHint && (
        <p className="px-3 pb-1 text-center text-[11px] text-ink-3">{cameraHint}</p>
      )}

      <div ref={listRef} className="shell-scroll min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-2">
        {messages.length === 0 && !pending && (
          <p className="rounded-lg bg-surface-2/70 px-3 py-2 text-[12px] leading-relaxed text-ink-3">
            {emptyHint ??
              "カメラをオンにして、マイクまたはテキストで会話できます。マイクを押して話し、もう一度押すと送信されます。"}
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cx(
              "max-w-[95%] rounded-lg px-3 py-2 text-[13px] leading-relaxed",
              m.role === "user"
                ? "ml-auto bg-accent text-accent-contrast"
                : "mr-auto border border-line bg-surface-2 text-ink",
            )}
          >
            {m.content}
          </div>
        ))}
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
        {speechHint && <p className="text-[12px] text-ink-3">{speechHint}</p>}
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
        <div className="flex items-end gap-2">
          <textarea
            value={listening || finishing ? liveText || draft : draft}
            onChange={(e) => {
              if (!listening && !finishing) setDraft(e.target.value);
            }}
            readOnly={listening || finishing}
            rows={2}
            placeholder="質問を入力…"
            className="min-h-[2.75rem] flex-1 resize-none rounded-md border border-line bg-surface-0 px-2.5 py-2 text-[13px] text-ink outline-none focus:border-accent"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (listening) void stopListenAndSend();
                else if (!finishing) void submit(draft);
              }
            }}
          />
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
    </aside>
  );
}
