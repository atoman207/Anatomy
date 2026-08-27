"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Phase = "idle" | "listening" | "typing" | "done";

const LISTEN_MS = 950;
/** Half of the previous 26ms/char pace. */
const MS_PER_CHAR = 52;
const RESTART_DELAY_MS = 3000;
/** How long the strip takes to fill its width before scrolling. */
const WAVE_FILL_MS = 900;
/** Classic equalizer bar geometry (rounded stems, readable gaps). */
const BAR_PX = 3;
const BAR_GAP_PX = 2.5;
const BAR_RX = 1.5;
/**
 * Enough samples for one full-width lap (~640px). Duplicated in the DOM
 * for a seamless left→right scroll after the strip has filled.
 */
const FREQ_BARS = Array.from({ length: 110 }, (_, i) => {
  const t = i / 110;
  const a = 42 + 28 * Math.sin(t * Math.PI * 5.5);
  const b = 16 * Math.sin(t * Math.PI * 13 + 0.8);
  const c = 8 * Math.sin(t * Math.PI * 29 + 1.4);
  return Math.max(12, Math.min(100, a + b + c));
});
/** Brand blue stops live on the SVG gradient below. */
const WAVE_TRACK_WIDTH_PX = FREQ_BARS.length * (BAR_PX + BAR_GAP_PX);

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
  /** 0 = hidden, 1 = strip filled across its width (then scroll kicks in). */
  const [waveFill, setWaveFill] = useState(0);
  const [waveScrolling, setWaveScrolling] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const waveRafRef = useRef<number | null>(null);
  const listenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoplayedRef = useRef(false);
  /**
   * Always the latest `play` closure. The loop below schedules its own
   * restart via this ref rather than closing over `play` directly - `play`
   * is recreated whenever `text` changes, and a pending setTimeout from a
   * previous render would otherwise keep calling a stale closure (looping
   * forever on old `text`/`clearTimers`/`startWave`) instead of picking up
   * the current one.
   */
  const playRef = useRef<() => void>(() => {});

  const clearTimers = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (waveRafRef.current !== null) cancelAnimationFrame(waveRafRef.current);
    if (listenTimeoutRef.current !== null) clearTimeout(listenTimeoutRef.current);
    if (restartTimeoutRef.current !== null) clearTimeout(restartTimeoutRef.current);
    rafRef.current = null;
    waveRafRef.current = null;
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

  const stop = useCallback(() => {
    clearTimers();
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* noop */
    }
    setWaveScrolling(false);
    setPhase("done");
  }, [clearTimers]);

  const startWave = useCallback(() => {
    setWaveFill(0);
    setWaveScrolling(false);
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / WAVE_FILL_MS);
      setWaveFill(t);
      if (t >= 1) {
        setWaveScrolling(true);
        waveRafRef.current = null;
        return;
      }
      waveRafRef.current = requestAnimationFrame(tick);
    };
    waveRafRef.current = requestAnimationFrame(tick);
  }, []);

  const play = useCallback(() => {
    clearTimers();
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* noop */
    }
    setShownLength(0);
    setPhase("listening");
    // Waveform appears the moment sound / listening starts.
    startWave();

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
          setWaveScrolling(false);
          rafRef.current = null;
          // Loop on its own - a visitor should not have to touch anything
          // to see the whole cycle more than once.
          restartTimeoutRef.current = setTimeout(() => playRef.current(), RESTART_DELAY_MS);
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }, LISTEN_MS);
  }, [clearTimers, startWave, text]);

  useEffect(() => {
    playRef.current = play;
  }, [play]);

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
  const recording = phase === "listening" || phase === "typing";
  const waveVisible = phase !== "idle";

  return (
    <div ref={containerRef} className="mx-auto mt-10 max-w-[640px]">
      <style>{`
        @keyframes chondroWaveScroll {
          from { transform: translateX(-50%); }
          to { transform: translateX(0); }
        }
      `}</style>

      <p className="sr-only">{text}</p>

      {/* Flat panel — no floating card chrome (rounded shell, shadow, or
          traffic-light title bar). */}
      <div aria-hidden className="flex flex-col gap-5">
        {(phase === "typing" || phase === "done") && (
          <div className="min-h-[9.5rem] rounded-2xl border-[0.5px] border-black/10 bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:p-5">
            <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed text-ink">
              {shown}
              {phase === "typing" && (
                <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[3px] animate-pulse bg-accent" />
              )}
            </p>
          </div>
        )}

        <div className="flex w-full items-center gap-4">
          <button
            type="button"
            onClick={recording ? stop : play}
            aria-label={recording ? "停止" : "録音開始"}
            className="relative grid h-14 w-14 shrink-0 place-items-center rounded-full bg-accent text-accent-contrast transition-transform hover:scale-105"
          >
            {phase === "listening" && (
              <>
                <span className="absolute inset-0 animate-ping rounded-full bg-accent/50" />
                <span className="absolute -inset-2 animate-ping rounded-full bg-accent/20 [animation-delay:200ms]" />
              </>
            )}
            {recording ? (
              <svg viewBox="0 0 24 24" className="relative h-5 w-5" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1.5" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="relative h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="9" y="2.5" width="6" height="11" rx="3" />
                <path d="M5.5 11a6.5 6.5 0 0 0 13 0" strokeLinecap="round" />
                <path d="M12 17.5V21" strokeLinecap="round" />
                <path d="M8.5 21h7" strokeLinecap="round" />
              </svg>
            )}
          </button>

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-[13px] font-medium text-ink">
              {phase === "idle" && "まもなく開始します…"}
              {phase === "listening" && "聞き取っています…"}
              {phase === "typing" && "文字起こし中…"}
              {phase === "done" && "文字起こしが完了しました"}
            </p>

            {waveVisible && (
              <div
                className="relative h-[60px] w-full overflow-hidden"
                role="img"
                aria-label="音声周波数"
                style={{
                  clipPath: `inset(0 ${Math.max(0, (1 - waveFill) * 100)}% 0 0)`,
                }}
              >
                <svg
                  width={WAVE_TRACK_WIDTH_PX * 2}
                  height={60}
                  viewBox={`0 0 ${WAVE_TRACK_WIDTH_PX * 2} 60`}
                  className="block h-full"
                  style={{
                    animation: waveScrolling ? "chondroWaveScroll 4.5s linear infinite" : undefined,
                  }}
                  aria-hidden
                >
                  <defs>
                    <linearGradient
                      id="chondroWaveGrad"
                      gradientUnits="userSpaceOnUse"
                      spreadMethod="repeat"
                      x1={0}
                      y1={0}
                      x2={WAVE_TRACK_WIDTH_PX}
                      y2={0}
                    >
                      <stop offset="0%" stopColor="#1d4ed8" />
                      <stop offset="45%" stopColor="#2563eb" />
                      <stop offset="100%" stopColor="#60a5fa" />
                    </linearGradient>
                  </defs>
                  <g fill="url(#chondroWaveGrad)" opacity={phase === "done" ? 0.75 : 1}>
                    {[0, 1].map((dup) =>
                      FREQ_BARS.map((peak, i) => {
                        const x = dup * WAVE_TRACK_WIDTH_PX + i * (BAR_PX + BAR_GAP_PX);
                        const h = (peak / 100) * 56;
                        const y = (60 - h) / 2;
                        return (
                          <rect
                            key={`${dup}-${i}`}
                            x={x}
                            y={y}
                            width={BAR_PX}
                            height={h}
                            rx={BAR_RX}
                          />
                        );
                      }),
                    )}
                  </g>
                </svg>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
