"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, Callout } from "@/components/ui";

export interface Recording {
  blob: Blob;
  url: string;
  mimeType: string;
  seconds: number;
  bytes: number;
}

/** Picks a container the browser can actually produce. */
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

/**
 * Microphone recorder with a live level meter.
 *
 * The meter is not decoration: without it there is no way to tell a silent
 * take from a working one until after transcription has been paid for and
 * come back empty.
 */
export function Recorder({
  onComplete, disabled,
}: {
  onComplete: (rec: Recording) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<"idle" | "recording" | "paused">("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Read from the browser rather than written into state by an effect: the
  // server has no MediaRecorder, so it renders the optimistic case and the
  // real answer arrives with the first client read.
  const supported = useSyncExternalStore(
    () => () => {},
    () =>
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== "undefined",
    () => true,
  );

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const pausedMsRef = useRef(0);
  const pausedAtRef = useRef(0);

  const cleanup = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // Level meter
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 90));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        const elapsed = (Date.now() - startedAtRef.current - pausedMsRef.current) / 1000;
        cleanup();
        setState("idle");
        setLevel(0);
        setSeconds(0);
        if (blob.size > 0) {
          onComplete({
            blob,
            url: URL.createObjectURL(blob),
            mimeType: type,
            seconds: Math.max(0, elapsed),
            bytes: blob.size,
          });
        } else {
          setError("録音データが空でした。マイクを確認してください。");
        }
      };

      startedAtRef.current = Date.now();
      pausedMsRef.current = 0;
      // A timeslice keeps chunks flowing, so a long take is not lost if the
      // tab is backgrounded.
      recorder.start(1000);
      recorderRef.current = recorder;
      setState("recording");
    } catch (e) {
      cleanup();
      const message =
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "マイクの使用が許可されませんでした。ブラウザの権限設定を確認してください。"
          : e instanceof DOMException && e.name === "NotFoundError"
            ? "マイクが見つかりません。接続を確認してください。"
            : e instanceof Error
              ? e.message
              : "録音を開始できませんでした。";
      setError(message);
    }
  }

  // Elapsed-time ticker
  useEffect(() => {
    if (state !== "recording") return;
    const id = setInterval(() => {
      setSeconds((Date.now() - startedAtRef.current - pausedMsRef.current) / 1000);
    }, 200);
    return () => clearInterval(id);
  }, [state]);

  function stop() {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }

  function togglePause() {
    const r = recorderRef.current;
    if (!r) return;
    if (r.state === "recording") {
      r.pause();
      pausedAtRef.current = Date.now();
      setState("paused");
    } else if (r.state === "paused") {
      r.resume();
      pausedMsRef.current += Date.now() - pausedAtRef.current;
      setState("recording");
    }
  }

  if (!supported) {
    return (
      <Callout tone="warn" title="このブラウザは録音に対応していません">
        Chrome、Edge、Firefox、または Safari の最新版をお使いください。
        書き起こしテキストを直接貼り付けることもできます。
      </Callout>
    );
  }

  const mmss = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

  return (
    <div className="flex flex-col gap-3">
      {error && <Callout tone="danger" title="録音できません">{error}</Callout>}

      <div className="flex flex-wrap items-center gap-3">
        {state === "idle" ? (
          <Button variant="primary" icon="mic" onClick={start} disabled={disabled}>
            録音開始
          </Button>
        ) : (
          <>
            <Button variant="danger" icon="stop" onClick={stop}>停止</Button>
            <Button icon={state === "paused" ? "play" : "pause"} onClick={togglePause}>
              {state === "paused" ? "再開" : "一時停止"}
            </Button>
          </>
        )}

        {state !== "idle" && (
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className={
                state === "recording"
                  ? "inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--danger)]"
                  : "inline-block h-2.5 w-2.5 rounded-full bg-[var(--warn)]"
              }
            />
            <span className="font-mono text-sm tabular-nums text-ink">{mmss}</span>
            <span className="text-xs text-ink-3">
              {state === "paused" ? "一時停止中" : "録音中"}
            </span>
          </div>
        )}
      </div>

      {state !== "idle" && (
        <div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
            role="meter"
            aria-label="入力レベル"
            aria-valuenow={Math.round(level * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full transition-[width] duration-75"
              style={{
                width: `${Math.round(level * 100)}%`,
                backgroundColor:
                  level > 0.9 ? "var(--danger)" : level > 0.05 ? "var(--good)" : "var(--warn)",
              }}
            />
          </div>
          <p className="mt-1 text-[11px] text-ink-3">
            {level < 0.03
              ? "音声が検出されていません。マイクに近づいてください。"
              : level > 0.9
                ? "音量が大きすぎます。少し離れてください。"
                : "入力レベルは良好です。"}
          </p>
        </div>
      )}
    </div>
  );
}
