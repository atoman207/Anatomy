"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cx } from "@/components/ui";

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

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduced =
      typeof window !== "undefined"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setVisible(true);
      return;
    }

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
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={cx("landing-reveal", visible && "is-visible", className)}
      style={{ "--reveal-delay": `${delayMs}ms` } as CSSProperties}
    >
      {children}
    </Tag>
  );
}
