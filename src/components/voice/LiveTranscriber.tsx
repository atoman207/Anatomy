"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Badge, Button, TextArea, cx } from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import {
  SpeechSession, isWebSpeechSupported, fullTranscript, joinJapanese,
  EMPTY_TRANSCRIPT, type TranscriptState,
} from "@/lib/voice/webSpeech";

/**
 * Free, real-time dictation using the browser's speech engine.
 *
 * The transcript box is always a normal text field (type / paste / edit).
 * Speaking appends onto whatever is already there; pause, edit, then continue.
 * The mic control sits in the lower-right corner of the box.
 */
export function LiveTranscriber({
  onCommit, onUnavailable, disabled, committedText = "", onCommittedTextChange, lang = "ja-JP",
}: {
  /** Called with the finished transcript when the user stops speaking. */
  onCommit: (text: string) => void;
  /** Called when this browser cannot run recognition at all. */
  onUnavailable?: (reason: string) => void;
  disabled?: boolean;
  /** Current transcript — editable while not listening. */
  committedText?: string;
  onCommittedTextChange?: (text: string) => void;
  /** BCP-47 recognition language. Defaults to Japanese; pass "en-US" for English. */
  lang?: string;
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
  /**
   * Snapshot of the editable text when listening began — speech appends onto
   * this. Real state, not a ref, since `displayValue` below reads it during
   * render (a ref read during render can silently miss a re-render).
   */
  const [baseText, setBaseText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // Keep the caret / scroll near the newest words during a long dictation.
  useEffect(() => {
    if (!listening) return;
    const el = textareaRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [listening, state]);

  const start = useCallback(() => {
    setDead(false);
    setListening(true);

    const base = (committedText ?? "").trimEnd();
    setBaseText(base);

    const session = new SpeechSession(
      {
        onTranscript: (next) => {
          setState(next);
          // Live-push the growing transcript so a parent that keys off the
          // text (e.g. enabling "次のステップ") stays up to date mid-speech.
          const spoken = fullTranscript(next);
          const merged = base ? joinJapanese(base, spoken) : spoken;
          onCommittedTextChange?.(merged);
        },
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
      { lang },
    );

    sessionRef.current?.dispose();
    sessionRef.current = session;
    startedAtRef.current = Date.now();
    setElapsed(0);
    setState(EMPTY_TRANSCRIPT);
    // Session starts empty; we merge onto `base` ourselves so manual edits
    // between pauses are never overwritten by a stale recognizer buffer.
    session.setTranscript("");
    session.start();
  }, [committedText, lang, onCommittedTextChange, onUnavailable, toast]);

  const stop = useCallback(() => {
    const session = sessionRef.current;
    session?.stop();
    const spoken = session ? fullTranscript(session.transcript) : fullTranscript(state);
    const merged = (baseText ? joinJapanese(baseText, spoken) : spoken).trim();
    setState(EMPTY_TRANSCRIPT);
    if (merged) {
      onCommittedTextChange?.(merged);
      onCommit(merged);
    }
  }, [baseText, onCommit, onCommittedTextChange, state]);

  function clear() {
    sessionRef.current?.dispose();
    sessionRef.current = null;
    setState(EMPTY_TRANSCRIPT);
    setBaseText("");
    onCommittedTextChange?.("");
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
  const hasText = (committedText ?? "").trim().length > 0;
  const spokenLive = fullTranscript(state);
  const displayValue = listening
    ? (baseText ? joinJapanese(baseText, spokenLive) : spokenLive)
    : (committedText ?? "");
  const continueLabel = hasText ? "話し続ける" : "話し始める";

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <TextArea
          ref={textareaRef}
          value={displayValue}
          onChange={(e) => {
            if (listening) return;
            onCommittedTextChange?.(e.target.value);
          }}
          readOnly={listening}
          disabled={disabled && !listening}
          placeholder="ここに直接入力・貼り付けできます。「話し始める」で音声も追加されます。"
          className="min-h-32 resize-y pb-12 pr-14 font-mono text-[13px] leading-relaxed"
          aria-label="書き起こしテキスト"
        />

        <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
          {listening && (
            <span className="mr-1 flex items-center gap-1.5 rounded-full bg-surface-1/90 px-2 py-0.5 text-[11px] text-ink-2 shadow-sm">
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--danger)]"
              />
              <span className="font-mono tabular-nums">{mmss}</span>
            </span>
          )}
          {!listening ? (
            <Button
              type="button"
              size="sm"
              variant="primary"
              icon="mic"
              onClick={start}
              disabled={disabled || dead}
              title={continueLabel}
              aria-label={continueLabel}
              className="!px-2.5 !py-2 shadow-[var(--shadow-sm)]"
            />
          ) : (
            <Button
              type="button"
              size="sm"
              variant="danger"
              icon="stop"
              onClick={stop}
              title="停止して編集"
              aria-label="停止して編集"
              className="!px-2.5 !py-2 shadow-[var(--shadow-sm)]"
            />
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {hasText && !listening && (
          <Button type="button" size="sm" icon="clear" onClick={clear} disabled={disabled}>
            クリア
          </Button>
        )}
        {hasText && <Badge tone="neutral">{displayValue.length} 文字</Badge>}
        <p className={cx("text-[11px] text-ink-3", listening ? "text-ink-2" : undefined)}>
          {listening
            ? "認識中… 右下の停止ボタンで止めてから編集できます。"
            : hasText
              ? "右下のマイクで、この続きから話し続けられます。"
              : "入力・貼り付けするか、右下のマイクで話し始めてください。"}
        </p>
      </div>
    </div>
  );
}
