"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Phase = "idle" | "listening" | "typing" | "done";

const LISTEN_MS = 950;
/** Half the original 13ms/char pace, per request. */
const MS_PER_CHAR = 26;
const RESTART_DELAY_MS = 3000;
const WAVE_HEIGHTS = [35, 70, 100, 55, 85, 40, 65, 90, 50, 30];
/** One marquee lap of small mic glyphs; rendered twice back-to-back for a seamless loop. */
const MARQUEE_GLYPHS = Array.from({ length: 10 }, (_, i) => i);

/**
 * A decorative, self-playing demo of the app's own voice-input feature (see
 * LiveTranscriber, used in the real /record wizard). It starts on its own
 * the moment it scrolls into view - no click required - runs the mic
 * "listening" beat, then fills in the given text character by character,
 * as if it just landed in a chat window from dictation, and loops itself
 * a few seconds after finishing.
 *
 * Purely visual by default. The optional SpeechSynthesis narration is
 * best-effort only - wrapped so a browser that blocks it (autoplay policy,
 * no ja-JP voice installed) never breaks the typing animation, which runs
 * on its own clock regardless of whether audio actually played.
 *
 * The full text is always present for assistive tech via a `sr-only`
 * paragraph; the animated bubble underneath it is `aria-hidden` so a screen
 * reader is not read the same sentence twice, once whole and once character
 * by character.
 */
export function VoiceTranscribeChat({ text }: { text: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [shownLength, setShownLength] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const listenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoplayedRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (listenTimeoutRef.current !== null) clearTimeout(listenTimeoutRef.current);
    if (restartTimeoutRef.current !== null) clearTimeout(restartTimeoutRef.current);
    rafRef.current = null;
    listenTimeoutRef.current = null;
    restartTimeoutRef.current = null;
  }, []);

  useEffect(
    () => () => {
      clearTimers();
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* noop */
      }
    },
    [clearTimers],
  );

  const play = useCallback(() => {
    clearTimers();
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* noop */
    }
    setShownLength(0);
    setPhase("listening");

    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "ja-JP";
        utterance.rate = 1.1;
        window.speechSynthesis.speak(utterance);
      }
    } catch {
      /* Narration is a bonus, never required for the visual. */
    }

    listenTimeoutRef.current = setTimeout(() => {
      setPhase("typing");
      const start = performance.now();
      const tick = (now: number) => {
        const elapsed = now - start;
        const next = Math.min(text.length, Math.floor(elapsed / MS_PER_CHAR));
        setShownLength(next);
        if (next >= text.length) {
          setPhase("done");
          rafRef.current = null;
          // Loop on its own - a visitor should not have to touch anything
          // to see the whole cycle more than once.
          restartTimeoutRef.current = setTimeout(() => play(), RESTART_DELAY_MS);
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }, LISTEN_MS);
  }, [clearTimers, text]);

  // Starts on its own the first time this section is scrolled into view -
  // the whole point is that nobody has to click a mic button to see it.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (autoplayedRef.current) return;
        if (entries.some((e) => e.isIntersecting)) {
          autoplayedRef.current = true;
          play();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = text.slice(0, shownLength);
  const progressPct = phase === "done" ? 100 : Math.round((shownLength / text.length) * 100);
  const busy = phase === "listening" || phase === "typing";

  return (
    <div ref={containerRef} className="mx-auto mt-10 max-w-[640px]">
      <style>{`
        @keyframes chondroMicMarquee {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
      `}</style>

      <p className="sr-only">{text}</p>

      {/* No outer frame border - only the inner message bubble reads as a
          bordered "window", per request. */}
      <div aria-hidden className="overflow-hidden rounded-2xl bg-surface-1 shadow-[0_8px_30px_rgba(0,0,0,0.08)]">
        <div className="flex items-center gap-1.5 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 text-[12px] text-ink-3">音声入力 — 実験ノートの文字起こし</span>
        </div>

        {/* A continuous strip of mic glyphs scrolling across the panel -
            duplicated once so the loop point is invisible. */}
        <div className="relative overflow-hidden bg-surface-2/60 py-2">
          <div
            className="flex w-max items-center gap-8 px-4"
            style={{ animation: "chondroMicMarquee 16s linear infinite" }}
          >
            {[0, 1].map((dup) =>
              MARQUEE_GLYPHS.map((i) => (
                <svg
                  key={`${dup}-${i}`}
                  viewBox="0 0 24 24"
                  className="h-4 w-4 shrink-0 text-accent/40"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <rect x="9" y="3" width="6" height="10" rx="3" />
                  <path d="M6 10.5a6 6 0 0 0 12 0" strokeLinecap="round" />
                  <path d="M12 16.5V20" strokeLinecap="round" />
                </svg>
              )),
            )}
          </div>
        </div>

        <div className="flex flex-col gap-5 p-6 sm:p-8">
          <div className="min-h-[9.5rem] rounded-xl border border-line bg-surface-0 p-4 sm:p-5">
            {phase === "idle" ? (
              <p className="text-[14px] leading-relaxed text-ink-3">
                マイクをタップすると、話した内容がここに文字として現れます。
              </p>
            ) : (
              <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed text-ink">
                {shown}
                {phase === "typing" && (
                  <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[3px] animate-pulse bg-accent" />
                )}
              </p>
            )}
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={play}
              disabled={busy}
              className="relative grid h-14 w-14 shrink-0 place-items-center rounded-full bg-accent text-accent-contrast transition-transform hover:scale-105 disabled:cursor-default disabled:hover:scale-100"
            >
              {phase === "listening" && (
                <>
                  <span className="absolute inset-0 animate-ping rounded-full bg-accent/50" />
                  <span className="absolute -inset-2 animate-ping rounded-full bg-accent/20 [animation-delay:200ms]" />
                </>
              )}
              <svg viewBox="0 0 24 24" className="relative h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="9" y="2.5" width="6" height="11" rx="3" />
                <path d="M5.5 11a6.5 6.5 0 0 0 13 0" strokeLinecap="round" />
                <path d="M12 17.5V21" strokeLinecap="round" />
                <path d="M8.5 21h7" strokeLinecap="round" />
              </svg>
            </button>

            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <p className="text-[13px] font-medium text-ink">
                {phase === "idle" && "まもなく開始します…"}
                {phase === "listening" && "聞き取っています…"}
                {phase === "typing" && "文字起こし中…"}
                {phase === "done" && "文字起こしが完了しました"}
              </p>

              {phase === "listening" ? (
                <div className="flex h-5 items-end gap-[3px]">
                  {WAVE_HEIGHTS.map((h, i) => (
                    <span
                      key={i}
                      className="w-[3px] animate-pulse rounded-full bg-accent"
                      style={{ height: `${h}%`, animationDelay: `${i * 85}ms` }}
                    />
                  ))}
                </div>
              ) : (
                <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full bg-accent transition-[width] duration-100 ease-linear"
                    style={{ width: `${phase === "idle" ? 0 : progressPct}%` }}
                  />
                </div>
              )}
            </div>

            {phase === "done" && (
              <button
                type="button"
                onClick={play}
                className="shrink-0 text-[13px] font-medium text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
              >
                もう一度再生
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
