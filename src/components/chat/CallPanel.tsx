"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { MAX_CALL_PARTICIPANTS } from "@/lib/chat/shared";
import type { CallKind } from "@/lib/chat/types";
import {
  EMPTY_TRANSCRIPT,
  SpeechSession,
  fullTranscript,
  isWebSpeechSupported,
  type TranscriptState,
} from "@/lib/voice/webSpeech";

export type CaptionLang = "ja-JP" | "en-US";

const noopSubscribe = () => () => {};

/**
 * Whether the browser supports Web Speech, read without a hydration
 * mismatch: the server snapshot is always `false` (there is no `window`
 * server-side), and the client snapshot reflects the real browser -
 * `useSyncExternalStore` is what lets the two safely differ instead of an
 * effect flipping the value after mount.
 */
function useSpeechSupported(): boolean {
  return useSyncExternalStore(noopSubscribe, isWebSpeechSupported, () => false);
}

function VideoTile({
  stream,
  label,
  muted,
  large,
}: {
  stream: MediaStream | null;
  label: string;
  muted?: boolean;
  large?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  const hasVideo = !!stream?.getVideoTracks().some((t) => t.enabled);

  return (
    <div
      className={
        "relative overflow-hidden rounded-lg bg-black/80 " +
        (large ? "aspect-video w-full min-h-[10rem] max-h-full" : "aspect-video w-40 shrink-0")
      }
    >
      {hasVideo ? (
        <video ref={ref} autoPlay playsInline muted={muted} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[13px] font-bold text-white/70">
          {label.slice(0, 1).toUpperCase()}
        </div>
      )}
      <span className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
        {label}
      </span>
    </div>
  );
}

/** Rolling Meet-style caption line: keep the end of the transcript readable. */
function formatCaptionLine(state: TranscriptState): string {
  const text = fullTranscript(state).trim().replace(/\s+/g, " ");
  if (!text) return "";
  if (text.length <= 180) return text;
  return `…${text.slice(-177)}`;
}

/**
 * Call UI: compact PiP by default, or expanded to fill the message pane
 * (the CallProvider wrapper). Captions use the Web Speech API with a
 * Google Meet-style bottom overlay and EN/JA language selection.
 */
export function CallPanel({
  title,
  kind,
  localStream,
  remoteStreams,
  onLeave,
  onToggleMute,
  onToggleCamera,
}: {
  title: string;
  kind: CallKind;
  localStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  onLeave: () => void;
  onToggleMute: (muted: boolean) => void;
  onToggleCamera: (on: boolean) => void;
}) {
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(kind === "video");
  const [expanded, setExpanded] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [captionLang, setCaptionLang] = useState<CaptionLang>("ja-JP");
  const [transcript, setTranscript] = useState<TranscriptState>(EMPTY_TRANSCRIPT);
  const [captionHint, setCaptionHint] = useState<string | null>(null);
  const sessionRef = useRef<SpeechSession | null>(null);
  const participantCount = remoteStreams.size + 1;
  const speechSupported = useSpeechSupported();

  useEffect(() => {
    if (!captionsOn) {
      // Tearing down the external SpeechSession and resetting the UI state
      // that tracked it - legitimate effect use (synchronizing with a
      // non-React, imperative browser API), not derivable during render.
      sessionRef.current?.stop();
      sessionRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTranscript(EMPTY_TRANSCRIPT);
      setCaptionHint(null);
      return;
    }

    if (!isWebSpeechSupported()) {
      setCaptionHint("このブラウザは字幕に対応していません。");
      return;
    }

    setCaptionHint(null);
    setTranscript(EMPTY_TRANSCRIPT);
    const session = new SpeechSession(
      {
        onTranscript: setTranscript,
        onError: (err) => {
          if (err.kind === "not-allowed") {
            setCaptionHint("マイクの権限が必要です。");
            setCaptionsOn(false);
          } else if (!err.recoverable) {
            setCaptionHint(err.message);
          }
        },
        onStateChange: () => {},
        onDead: () => {
          setCaptionHint("音声認識を開始できませんでした。");
          setCaptionsOn(false);
        },
      },
      { lang: captionLang },
    );
    sessionRef.current = session;
    session.start();

    return () => {
      session.stop();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [captionsOn, captionLang]);

  const captionLine = formatCaptionLine(transcript);
  const showCaptionOverlay = captionsOn && (captionLine || captionHint);

  return (
    <div
      className={
        expanded
          ? "absolute inset-0 z-40 flex flex-col bg-[#202124] text-white"
          : "absolute bottom-4 right-4 z-40 flex max-w-[min(90vw,24rem)] flex-col gap-2 rounded-lg border border-line bg-surface-1 p-3 text-ink shadow-xl"
      }
    >
      <div
        className={
          "flex items-center justify-between gap-3 " + (expanded ? "shrink-0 px-4 py-3" : "")
        }
      >
        <div className="min-w-0">
          <p className={"truncate text-[13px] font-bold " + (expanded ? "text-white" : "text-ink")}>
            {title}
          </p>
          <p className={"text-[11px] " + (expanded ? "text-white/60" : "text-ink-3")}>
            {participantCount} / {MAX_CALL_PARTICIPANTS} 人が参加中
          </p>
        </div>
        <button
          type="button"
          aria-label={expanded ? "縮小表示" : "メッセージ画面いっぱいに拡大"}
          onClick={() => setExpanded((v) => !v)}
          className={
            "shrink-0 rounded-full p-2 " +
            (expanded
              ? "text-white/80 hover:bg-white/10 hover:text-white"
              : "bg-surface-2 text-ink hover:bg-surface-3")
          }
        >
          <Icon name={expanded ? "minimize" : "maximize"} className="h-4 w-4" />
        </button>
      </div>

      <div
        className={
          expanded
            ? "relative flex min-h-0 flex-1 flex-col"
            : "relative flex flex-wrap gap-1.5"
        }
      >
        <div
          className={
            expanded
              ? "grid min-h-0 flex-1 gap-3 overflow-auto p-4 " +
                (remoteStreams.size === 0
                  ? "grid-cols-1 place-items-center [&>*]:max-w-3xl [&>*]:w-full"
                  : "grid-cols-1 content-center sm:grid-cols-2")
              : "contents"
          }
        >
          <VideoTile stream={localStream} label="自分" muted large={expanded} />
          {[...remoteStreams.entries()].map(([peerId, stream]) => (
            <VideoTile key={peerId} stream={stream} label="参加者" large={expanded} />
          ))}
        </div>

        {showCaptionOverlay && (
          <div
            className={
              "pointer-events-none absolute inset-x-0 z-10 flex justify-center px-4 " +
              (expanded ? "bottom-4" : "bottom-1")
            }
            aria-live="polite"
          >
            <div
              className={
                "max-w-[min(100%,36rem)] rounded-lg bg-black/75 px-4 py-2 text-center text-[15px] leading-snug text-white shadow-lg " +
                (expanded ? "text-[16px] sm:text-[18px]" : "text-[12px]")
              }
            >
              {captionHint ?? captionLine}
            </div>
          </div>
        )}
      </div>

      <div
        className={
          "flex flex-wrap items-center justify-center gap-2 " +
          (expanded ? "shrink-0 border-t border-white/10 px-4 py-3" : "pt-1")
        }
      >
        <button
          type="button"
          aria-label={muted ? "ミュート解除" : "ミュート"}
          onClick={() => {
            const next = !muted;
            setMuted(next);
            onToggleMute(next);
          }}
          className={
            "rounded-full p-2 " +
            (muted
              ? "bg-danger-soft text-danger"
              : expanded
                ? "bg-white/15 text-white hover:bg-white/25"
                : "bg-surface-2 text-ink hover:bg-surface-3")
          }
        >
          <Icon name={muted ? "micOff" : "mic"} className="h-4 w-4" />
        </button>
        {kind === "video" && (
          <button
            type="button"
            aria-label={cameraOn ? "カメラをオフ" : "カメラをオン"}
            onClick={() => {
              const next = !cameraOn;
              setCameraOn(next);
              onToggleCamera(next);
            }}
            className={
              "rounded-full p-2 " +
              (!cameraOn
                ? "bg-danger-soft text-danger"
                : expanded
                  ? "bg-white/15 text-white hover:bg-white/25"
                  : "bg-surface-2 text-ink hover:bg-surface-3")
            }
          >
            <Icon name={cameraOn ? "video" : "videoOff"} className="h-4 w-4" />
          </button>
        )}

        <button
          type="button"
          aria-label={captionsOn ? "字幕をオフ" : "字幕をオン"}
          aria-pressed={captionsOn}
          disabled={!speechSupported && !captionsOn}
          title={
            speechSupported
              ? "字幕（Google Meet風）"
              : "このブラウザは字幕に対応していません"
          }
          onClick={() => setCaptionsOn((v) => !v)}
          className={
            "rounded-full p-2 " +
            (captionsOn
              ? "bg-accent text-white"
              : expanded
                ? "bg-white/15 text-white hover:bg-white/25"
                : "bg-surface-2 text-ink hover:bg-surface-3") +
            (!speechSupported && !captionsOn ? " opacity-40" : "")
          }
        >
          <Icon name="closedCaptions" className="h-4 w-4" />
        </button>

        <label className="flex items-center gap-1.5">
          <span className={"sr-only"}>字幕の言語</span>
          <select
            value={captionLang}
            onChange={(e) => setCaptionLang(e.target.value as CaptionLang)}
            aria-label="字幕の言語"
            className={
              "rounded-md border px-2 py-1.5 text-[12px] " +
              (expanded
                ? "border-white/20 bg-white/10 text-white"
                : "border-line bg-surface-1 text-ink")
            }
          >
            <option value="ja-JP">日本語</option>
            <option value="en-US">English</option>
          </select>
        </label>

        <button
          type="button"
          aria-label="通話を終了"
          onClick={onLeave}
          className="rounded-full bg-danger p-2 text-white hover:opacity-90"
        >
          <Icon name="phoneOff" className="h-4 w-4" />
        </button>
      </div>

      {!expanded && (
        <p className="text-center text-[10px] text-ink-3">
          最大{MAX_CALL_PARTICIPANTS}人まで・一部のネットワーク環境では接続できない場合があります
        </p>
      )}
    </div>
  );
}
