"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { cx } from "@/components/ui";

const TEXT = "話すだけで、実験記録からAI査読まで。";
const MS_PER_CHAR = 52;
/** Aligns with the hero headline entrance delay in `page.tsx`. */
const START_DELAY_MS = 140;

const noopSubscribe = () => () => {};

function getReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Hero headline typed character by character on a single line.
 * Full text is always available to assistive tech via a screen-reader-only
 * span; motion is skipped when the visitor prefers reduced motion.
 */
export function HeroTypewriter({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const reduced = useSyncExternalStore(noopSubscribe, getReducedMotion, () => false);
  const [charIndex, setCharIndex] = useState(reduced ? TEXT.length : 0);
  const [done, setDone] = useState(reduced);
  const rafRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (reduced) {
      setCharIndex(TEXT.length);
      setDone(true);
      return;
    }

    const clear = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      rafRef.current = null;
      timeoutRef.current = null;
    };

    timeoutRef.current = setTimeout(() => {
      setCharIndex(0);
      setDone(false);
      const start = performance.now();
      const tick = (now: number) => {
        const elapsed = now - start;
        const next = Math.min(TEXT.length, Math.floor(elapsed / MS_PER_CHAR));
        setCharIndex(next);
        if (next >= TEXT.length) {
          rafRef.current = null;
          setDone(true);
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }, START_DELAY_MS);

    return clear;
  }, [reduced]);

  const visible = TEXT.slice(0, charIndex);

  return (
    <h1 className={cx(className)} style={style} aria-live={done ? "off" : "polite"}>
      <span className="sr-only">{TEXT}</span>
      <span className="block whitespace-nowrap">
        {visible}
        {!done && (
          <span className="text-accent opacity-80" aria-hidden>|</span>
        )}
      </span>
    </h1>
  );
}
