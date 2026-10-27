"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { cx } from "@/components/ui";

/**
 * The assistant persona (Anam clone) outside the live stream.
 *
 * Both media come from `/api/ai/avatar/*`, which redirect to fresh signed
 * URLs from Anam. If the avatar is not configured those return 404, and the
 * components fall back to the bundled portrait so nothing renders broken.
 */

const IDLE_SRC = "/api/ai/avatar/idle";
const PORTRAIT_SRC = "/api/ai/avatar/portrait";
const FALLBACK_SRC = "/chatbot.png";

/**
 * Her idle loop: a muted, looping clip of the persona breathing and blinking.
 * `deferred` waits until the page has loaded and gone idle before fetching
 * (~1.5 MB), so it never competes with the page's own content.
 */
export function PersonaLoop({
  className,
  deferred = false,
}: {
  className?: string;
  deferred?: boolean;
}) {
  const [src, setSrc] = useState<string | null>(deferred ? null : IDLE_SRC);
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!deferred) return;
    let handle = 0;
    const begin = () => {
      const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
        .requestIdleCallback;
      if (idle) handle = idle(() => setSrc(IDLE_SRC), { timeout: 3000 });
      else handle = window.setTimeout(() => setSrc(IDLE_SRC), 1200);
    };
    if (document.readyState === "complete") begin();
    else window.addEventListener("load", begin, { once: true });
    return () => {
      window.removeEventListener("load", begin);
      const cancel = (window as Window & { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
      if (cancel) cancel(handle);
      window.clearTimeout(handle);
    };
  }, [deferred]);

  if (failed) {
    return <Image src={FALLBACK_SRC} alt="" fill sizes="24rem" className={cx("object-cover object-top", className)} />;
  }

  return (
    <video
      ref={videoRef}
      src={src ?? undefined}
      poster={PORTRAIT_SRC}
      autoPlay
      muted
      loop
      playsInline
      preload={src ? "auto" : "none"}
      aria-hidden
      onError={() => {
        // A poster/clip 404 (avatar not configured) - show the bundled portrait.
        if (src) setFailed(true);
      }}
      className={cx("h-full w-full object-cover", className)}
    />
  );
}

/** Small round portrait for the header and chat bubbles. */
export function PersonaThumb({ size, className }: { size: number; className?: string }) {
  const [src, setSrc] = useState(PORTRAIT_SRC);
  return (
    <Image
      src={src}
      alt=""
      width={size * 2}
      height={size * 2}
      unoptimized
      onError={() => setSrc(FALLBACK_SRC)}
      className={cx("shrink-0 rounded-full object-cover object-top", className)}
      style={{ width: size, height: size }}
    />
  );
}
