"use client";

import { Component, useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { cx } from "@/components/ui";
import type { AvatarState } from "@/lib/avatar/protocol";
import type { LipSyncSource } from "./useAssistantVoice";
import type { AvatarController } from "./avatar/useAvatarController";
import { TalkingPortrait, type PortraitFraming } from "./TalkingPortrait";

// three.js is ~600 KB; load it only once a model is known to exist.
const TalkingAvatar = dynamic(() => import("./TalkingAvatar"), { ssr: false });
const PixelStreamingAvatar = dynamic(
  () => import("./avatar/PixelStreamingAvatar").then((m) => m.PixelStreamingAvatar),
  { ssr: false },
);

const MODEL_URL = process.env.NEXT_PUBLIC_AVATAR_MODEL_URL || "/models/assistant.glb";
/** ws(s):// URL of the Pixel Streaming signalling server for the MetaHuman. */
const PIXEL_STREAMING_URL = process.env.NEXT_PUBLIC_PIXEL_STREAMING_URL || "";

class AvatarErrorBoundary extends Component<
  { onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

type StageMode = "checking" | "unreal" | "3d" | "photo";

const STATE_LABEL: Record<AvatarState, string | null> = {
  IDLE: null,
  LISTENING: "聞いています",
  THINKING: "考えています",
  SPEAKING: "話しています",
  INTERRUPTED: "どうぞ",
};

/**
 * The assistant's video area.
 *
 * Renderer, best first:
 * 1. `unreal` - MetaHuman in Unreal Engine 5 over Pixel Streaming, when
 *    `NEXT_PUBLIC_PIXEL_STREAMING_URL` is set and the stream connects.
 * 2. `3d`     - browser-native three.js avatar, when the glTF model exists
 *    (`NEXT_PUBLIC_AVATAR_MODEL_URL`, default `/models/assistant.glb`).
 * 3. `photo`  - the persona portrait animated in WebGL (`TalkingPortrait`):
 *    lips follow the voice, blinks, head motion, plus a state indicator.
 * Each falls through to the next on failure.
 */
export function AssistantAvatarStage({
  lipSync,
  speaking,
  avatar,
  className,
  framing = "stage",
  showStatus = true,
  bare = false,
  setting = "none",
}: {
  lipSync: LipSyncSource;
  speaking: boolean;
  avatar: AvatarController;
  className?: string;
  framing?: PortraitFraming;
  /** Hide the built-in state pill when the caller renders its own. */
  showStatus?: boolean;
  /**
   * Character only: no backdrop, and nothing (not the photo) while the 3D
   * model loads. The photo appears only if 3D is unavailable.
   */
  bare?: boolean;
  /** "lab": the 3D assistant sits at a laboratory desk (3D renderer only). */
  setting?: "none" | "lab";
}) {
  const [mode, setMode] = useState<StageMode>(PIXEL_STREAMING_URL ? "unreal" : "checking");
  const [ready, setReady] = useState(false);
  const { setRemote, driver, state } = avatar;

  useEffect(() => {
    if (mode !== "checking") return;
    let cancelled = false;
    const decide = (next: StageMode) => {
      if (!cancelled) setMode(next);
    };
    if (!webglAvailable()) {
      decide("photo");
      return;
    }
    fetch(MODEL_URL, { method: "HEAD" })
      .then((res) => decide(res.ok ? "3d" : "photo"))
      .catch(() => decide("photo"));
    return () => {
      cancelled = true;
    };
  }, [mode]);


  const showPhoto = mode === "photo" || (!bare && (mode === "checking" || (mode === "3d" && !ready)));
  const label = STATE_LABEL[state] ?? (speaking ? STATE_LABEL.SPEAKING : null);

  return (
    // `relative` would override a caller's `absolute inset-0` (Tailwind orders
    // relative after absolute) and collapse the stage to zero height.
    <div className={cx("overflow-hidden", !/\babsolute\b/.test(className ?? "") && "relative", className)}>
      {!bare && (
        // Bright lab-white set behind the 3D avatar, echoing the portrait.
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,#ffffff_0%,#eef2f7_55%,#dde4ee_100%)]"
        />
      )}
      {/* No 3D model / stream: the persona photo itself talks (WebGL warps). */}
      {showPhoto && (
        <TalkingPortrait
          lipSync={lipSync}
          driver={driver}
          framing={framing}
          className="absolute inset-0"
        />
      )}
      {mode === "unreal" && (
        <AvatarErrorBoundary onError={() => setMode("checking")}>
          <PixelStreamingAvatar
            signallingUrl={PIXEL_STREAMING_URL}
            onRemote={setRemote}
            onFailed={() => {
              setRemote(null);
              setMode("checking");
            }}
          />
        </AvatarErrorBoundary>
      )}
      {mode === "3d" && (
        <div
          className={cx(
            "absolute inset-0 transition-opacity duration-1000",
            ready ? "opacity-100" : "opacity-0",
          )}
        >
          <AvatarErrorBoundary onError={() => setMode("photo")}>
            <TalkingAvatar
              framing={setting === "lab" ? "desk" : framing === "body" ? "body" : "bust"}
              url={MODEL_URL}
              lipSync={lipSync}
              driver={driver}
              onError={() => setMode("photo")}
              onReady={() => setReady(true)}
            />
          </AvatarErrorBoundary>
        </div>
      )}
      <span
        aria-live="polite"
        className={cx(
          "absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] text-white transition-opacity",
          label && showStatus ? "opacity-100" : "opacity-0",
        )}
      >
        <span className="flex h-3 items-end gap-[2px]" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={cx("w-[3px] rounded-full bg-white", state !== "IDLE" && "animate-pulse")}
              style={{
                height: state === "SPEAKING" ? `${40 + ((i * 37) % 60)}%` : "35%",
                animationDelay: `${i * 120}ms`,
              }}
            />
          ))}
        </span>
        {label}
      </span>
    </div>
  );
}
