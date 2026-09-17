"use client";

import { useEffect, useRef, useState } from "react";
import {
  AVATAR_PROTOCOL_VERSION,
  UNREAL_CHUNK_CHARS,
  type FromUnrealMessage,
  type ToUnrealMessage,
} from "@/lib/avatar/protocol";
import { bytesToBase64, chunkString } from "@/lib/avatar/encode";
import type { RemoteAvatar } from "./useAvatarController";

/**
 * The Unreal Engine 5 MetaHuman avatar, rendered on a GPU server and shown
 * here as a WebRTC stream (Epic's Pixel Streaming frontend library).
 *
 * The browser sends conversation state, WAV audio, cues and fallback visemes
 * over the Pixel Streaming data channel (`emitUIInteraction`); Unreal plays
 * the audio inside the stream so voice and face stay in sync, and reports
 * back when speech starts and finishes. Wire format: `src/lib/avatar/protocol.ts`
 * and `unreal/LabnoteAvatar/PROTOCOL.md`.
 */

type PixelStreamingInstance = import("@epicgames-ps/lib-pixelstreamingfrontend-ue5.6").PixelStreaming;

/** Give up and fall back to the browser avatar if the stream never starts. */
const CONNECT_TIMEOUT_MS = 15_000;
/** Unreal should report `speech.finished`; this guards against a lost message. */
const FINISH_GRACE_MS = 2_500;

export function PixelStreamingAvatar({
  signallingUrl,
  onRemote,
  onFailed,
}: {
  signallingUrl: string;
  onRemote: (remote: RemoteAvatar | null) => void;
  onFailed: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "needs-tap">("connecting");
  const streamRef = useRef<PixelStreamingInstance | null>(null);
  const callbacks = useRef({ onRemote, onFailed });
  useEffect(() => {
    callbacks.current = { onRemote, onFailed };
  }, [onRemote, onFailed]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let live = false;
    const finishers = new Map<string, () => void>();

    const failTimer = setTimeout(() => {
      if (!live && !disposed) callbacks.current.onFailed();
    }, CONNECT_TIMEOUT_MS);

    void (async () => {
      let lib: typeof import("@epicgames-ps/lib-pixelstreamingfrontend-ue5.6");
      try {
        lib = await import("@epicgames-ps/lib-pixelstreamingfrontend-ue5.6");
      } catch {
        if (!disposed) callbacks.current.onFailed();
        return;
      }
      if (disposed) return;

      const config = new lib.Config({
        useUrlParams: false,
        initialSettings: {
          ss: signallingUrl,
          AutoConnect: true,
          AutoPlayVideo: true,
          StartVideoMuted: false,
          MatchViewportRes: true,
          HoveringMouse: false,
          KeyboardInput: false,
          MouseInput: false,
          TouchInput: false,
          GamepadInput: false,
          FakeMouseWithTouches: false,
          SuppressBrowserKeys: false,
        },
      });
      const stream = new lib.PixelStreaming(config, { videoElementParent: host });
      streamRef.current = stream;

      const send = (message: ToUnrealMessage) => {
        stream.emitUIInteraction(message);
      };

      const remote: RemoteAvatar = {
        send,
        speak: ({ wav, durationSec, text, plan, visemes, signal }) =>
          new Promise<void>((resolve, reject) => {
            const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            const chunks = chunkString(bytesToBase64(wav), UNREAL_CHUNK_CHARS);
            const firstEmotion = plan.cues.find((c) => c.kind === "emotion")?.name ?? "friendly";
            let timer: ReturnType<typeof setTimeout> | null = null;
            const done = () => {
              if (timer) clearTimeout(timer);
              finishers.delete(id);
              signal.removeEventListener("abort", onAbort);
              resolve();
            };
            const onAbort = () => {
              if (timer) clearTimeout(timer);
              finishers.delete(id);
              reject(new DOMException("aborted", "AbortError"));
            };
            signal.addEventListener("abort", onAbort, { once: true });
            finishers.set(id, done);

            send({
              type: "speak.begin",
              id,
              audioFormat: "wav",
              chunks: chunks.length,
              durationSec,
              text,
              emotion: firstEmotion as Extract<ToUnrealMessage, { type: "speak.begin" }>["emotion"],
              cues: plan.cues,
              visemeFps: 30,
              visemes,
            });
            chunks.forEach((data, index) => send({ type: "speak.chunk", id, index, data }));
            send({ type: "speak.end", id });
            // Upload + playback time, plus grace for a lost `speech.finished`.
            timer = setTimeout(done, durationSec * 1000 + FINISH_GRACE_MS + chunks.length * 20);
          }),
      };

      stream.addResponseEventListener("labnote-avatar", (response) => {
        let msg: FromUnrealMessage;
        try {
          msg = JSON.parse(response) as FromUnrealMessage;
        } catch {
          return;
        }
        if (msg.type === "speech.finished") finishers.get(msg.id)?.();
      });

      stream.addEventListener("dataChannelOpen", () => {
        if (disposed) return;
        send({ type: "hello", version: AVATAR_PROTOCOL_VERSION });
        callbacks.current.onRemote(remote);
      });
      stream.addEventListener("videoInitialized", () => {
        if (disposed) return;
        live = true;
        clearTimeout(failTimer);
        setStatus("live");
      });
      stream.addEventListener("playStreamRejected", () => {
        if (!disposed) setStatus("needs-tap");
      });
      stream.addEventListener("webRtcFailed", () => {
        if (!disposed) callbacks.current.onFailed();
      });
      stream.addEventListener("webRtcDisconnected", () => {
        if (disposed) return;
        callbacks.current.onRemote(null);
        if (live) callbacks.current.onFailed();
      });
    })();

    return () => {
      disposed = true;
      clearTimeout(failTimer);
      finishers.forEach((finish) => finish());
      callbacks.current.onRemote(null);
      try {
        streamRef.current?.emitUIInteraction({ type: "stop", reason: "closed" });
        streamRef.current?.disconnect();
      } catch {
        /* already gone */
      }
      streamRef.current = null;
      host.replaceChildren();
    };
  }, [signallingUrl]);

  return (
    <div className="absolute inset-0 bg-black">
      <div
        ref={hostRef}
        className="absolute inset-0 [&_video]:h-full [&_video]:w-full [&_video]:object-cover"
      />
      {status === "connecting" && (
        <p className="absolute inset-x-0 bottom-3 text-center text-[12px] text-white/80" aria-live="polite">
          アシスタントに接続しています…
        </p>
      )}
      {status === "needs-tap" && (
        <button
          type="button"
          className="absolute inset-0 grid place-items-center bg-black/50 text-[14px] font-bold text-white"
          onClick={() => {
            streamRef.current?.play();
            setStatus("live");
          }}
        >
          タップして映像と音声を開始
        </button>
      )}
    </div>
  );
}
