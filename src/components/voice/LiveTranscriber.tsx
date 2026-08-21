"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Badge, Button } from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import {
  SpeechSession, isWebSpeechSupported, fullTranscript,
  EMPTY_TRANSCRIPT, type TranscriptState,
} from "@/lib/voice/webSpeech";

/**
 * Free, real-time Japanese dictation using the browser's own speech engine.
 *
 * No API key and no per-minute cost. Text appears while you speak, which the
 * upload-and-wait path cannot do — worth having even alongside it.
 */
export function LiveTranscriber({
  onCommit, onUnavailable, disabled,
}: {
  /** Called with the finished transcript when the user stops. */
  onCommit: (text: string) => void;
  /** Called when this browser cannot run recognition at all. */
  onUnavailable?: (reason: string) => void;
  disabled?: boolean;
}) {
  const supported = useSyncExternalStore(
    () => () => {},
    () => isWebSpeechSupported(),
    () => true,
  );

  const [listening, setListening] = useState(false);
  const { toast } = useToast();
  const [state, setState] = useState<TranscriptState>(EMPTY_TRANSCRIPT);
  const [dead, setDead] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const sessionRef = useRef<SpeechSession | null>(null);
  const startedAtRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!listening) return;
    const id = setInterval(() => {
      setElapsed((Date.now() - startedAtRef.current) / 1000);
    }, 250);
    return () => clearInterval(id);
  }, [listening]);

  // Keep the newest words in view during a long dictation.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state]);

  const start = useCallback(() => {
    setDead(false);
    // Flip the UI immediately. Chrome can take a beat to fire `onstart`
    // (mic permission, connecting to the speech service), and leaving the
    // start button in place makes it look like the click did nothing.
    setListening(true);

    const session = new SpeechSession(
      {
        onTranscript: setState,
        onError: (e) => toast(e.message, { tone: "danger", title: "エラー" }),
        onStateChange: setListening,
        onDead: () => {
          setDead(true);
          setListening(false);
          onUnavailable?.(
            "このブラウザの音声認識エンジンが応答しません。Chrome または Edge をお使いいただくか、有料の文字起こしに切り替えてください。",
          );
        },
      },
      { lang: "ja-JP" },
    );

    sessionRef.current?.dispose();
    sessionRef.current = session;
    startedAtRef.current = Date.now();
    setElapsed(0);
    // Continue from whatever is already there rather than starting over.
    session.setTranscript(state.final);
    session.start();
  }, [onUnavailable, state.final, toast]);

  const stop = useCallback(() => {
    const session = sessionRef.current;
    session?.stop();
    const text = session ? fullTranscript(session.transcript) : fullTranscript(state);
    if (text.trim()) onCommit(text.trim());
  }, [onCommit, state]);

  function clear() {
    sessionRef.current?.dispose();
    sessionRef.current = null;
    setState(EMPTY_TRANSCRIPT);
    setDead(false);
    setElapsed(0);
    setListening(false);
  }

  if (!supported) {
    return (
      <p className="text-sm text-ink-2">
        このブラウザは無料の音声認識に対応していません。Chrome、Edge、または Safari をお使いください。
        Firefox は Web Speech API に対応していません。「有料」に切り替えれば、どのブラウザでも利用できます。
      </p>
    );
  }

  const mmss = `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, "0")}`;
  const charCount = fullTranscript(state).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {!listening ? (
          <Button type="button" variant="primary" icon="mic" onClick={start} disabled={disabled || dead}>
            話し始める
          </Button>
        ) : (
          <Button type="button" variant="danger" icon="stop" onClick={stop}>停止して確定</Button>
        )}

        {charCount > 0 && !listening && (
          <Button type="button" icon="clear" onClick={clear}>クリア</Button>
        )}

        {listening && (
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--danger)]"
            />
            <span className="font-mono text-sm tabular-nums text-ink">{mmss}</span>
            <span className="text-xs text-ink-3">認識中…</span>
          </div>
        )}

        {charCount > 0 && <Badge tone="neutral">{charCount} 文字</Badge>}
      </div>

      <div
        ref={scrollRef}
        aria-live="polite"
        aria-label="認識結果"
        className="max-h-56 min-h-24 overflow-y-auto rounded-lg border border-line bg-surface-1 px-3 py-2.5 text-sm leading-relaxed"
      >
        {state.final && <span className="text-ink">{state.final}</span>}
        {/* Interim text is shown greyed so it reads as provisional: the
            engine revises it as the phrase completes. */}
        {state.interim && (
          <span className="text-ink-3 italic">
            {state.final ? " " : ""}
            {state.interim}
          </span>
        )}
        {!state.final && !state.interim && (
          <span className="text-ink-3">
            {listening
              ? "話してください。認識された文字がここに表示されます…"
              : "「話し始める」を押すと、話した内容がリアルタイムで文字になります。"}
          </span>
        )}
      </div>

      {listening && (
        <p className="text-[11px] text-ink-3">
          区切りのよいところで自動的に確定されます。一時的に止まっても自動で再開します。
        </p>
      )}
    </div>
  );
}
