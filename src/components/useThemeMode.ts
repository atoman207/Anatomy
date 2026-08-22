"use client";

import { useSyncExternalStore } from "react";
import type { Mode } from "@/lib/plots/theme";

/**
 * Tracks the viewer's colour scheme so charts match the page they sit on.
 *
 * Read through `useSyncExternalStore`: the media query and the `data-theme`
 * attribute are both external systems, and subscribing to them directly costs
 * one render rather than the two an effect-plus-state pair would.
 *
 * Both sources matter. The attribute is what the header's own light/dark
 * toggle stamps, and it wins when present; with no explicit choice the OS
 * preference decides, which is also what the CSS falls back to - so a chart
 * drawn from this always agrees with the surface behind it.
 */
function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);

  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  return () => {
    mq.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

function read(): Mode {
  if (typeof window === "undefined") return "light";
  const stamped = document.documentElement.getAttribute("data-theme");
  if (stamped === "dark" || stamped === "light") return stamped;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useThemeMode(): Mode {
  // The server has no media query, so the first paint is always the light
  // figure; hydration corrects it in the same tick for a dark viewer.
  return useSyncExternalStore(subscribe, read, () => "light" as Mode);
}
