"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { cx } from "@/components/ui";

const noopSubscribe = () => () => {};

function getReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Fixed "Top" control for the landing page. Appears once the hero scrolls out
 * of view so visitors can jump back without hunting for the header logo.
 */
export function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);
  const reduced = useSyncExternalStore(noopSubscribe, getReducedMotion, () => false);

  useEffect(() => {
    const hero = document.getElementById("hero");
    if (!hero) return;

    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  }, [reduced]);

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="ページトップへ戻る"
      className={cx(
        "landing-scroll-top fixed bottom-6 right-6 z-40 rounded-full bg-accent px-4 py-2.5 text-[14px] font-semibold text-accent-contrast shadow-[0_2px_12px_rgba(37,99,235,0.35)] transition-[opacity,transform,visibility] duration-300",
        visible
          ? "visible translate-y-0 opacity-100"
          : "pointer-events-none invisible translate-y-2 opacity-0",
      )}
    >
      Top
    </button>
  );
}
