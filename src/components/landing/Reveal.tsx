"use client";

import {
  useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode,
} from "react";
import { cx } from "@/components/ui";

const noopSubscribe = () => () => {};

/** Read without a hydration mismatch - the server snapshot is always `false`. */
function getReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Scroll-triggered entrance for landing sections.
 *
 * Keeps motion intentional (fade + slight rise) and respects
 * `prefers-reduced-motion` by skipping the transition entirely.
 */
export function Reveal({
  children,
  className,
  delayMs = 0,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  delayMs?: number;
  as?: "div" | "section" | "article" | "header" | "li";
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const reduced = useSyncExternalStore(noopSubscribe, getReducedMotion, () => false);

  useEffect(() => {
    if (reduced) return;
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reduced]);

  return (
    <Tag
      ref={ref as never}
      className={cx("landing-reveal", (visible || reduced) && "is-visible", className)}
      style={{ "--reveal-delay": `${delayMs}ms` } as CSSProperties}
    >
      {children}
    </Tag>
  );
}
