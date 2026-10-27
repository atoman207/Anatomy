"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { AnamClient } from "@anam-ai/js-sdk";

type TalkMessageStream = ReturnType<AnamClient["createTalkMessageStream"]>;

/**
 * The assistant's live face and voice: the Anam clone persona, streamed over
 * WebRTC into a <video> element.
 *
 * Anam only renders - its own LLM is switched off server-side (see
 * `src/lib/ai/anam.ts`). Replies are written by the OpenAI realtime model and
 * pushed here through `speaker`, which the persona speaks with lip-synced
 * video. The microphone stays with OpenAI (`disableInputAudio`), so Anam
 * never hears the user and cannot answer on its own.
 */

export type AnamStatus = "off" | "connecting" | "live" | "ended" | "failed";

export interface SpeakerHandlers {
  onSpeakingStart(): void;
  onSpeakingEnd(): void;
  /** The avatar went away (session ended or failed) - fall back to voice. */
  onUnavailable?(): void;
}

/** What the conversation hook needs to make the persona talk. */
export interface AvatarSpeaker {
  isLive(): boolean;
  /** Starts one reply; its text follows via `push`, then `end`. */
  begin(): void;
  push(text: string): void;
  end(): void;
  /** A whole reply at once (cached answers). */
  say(text: string): void;
  /** The user cut in: stop talking now. */
  interrupt(): void;
  subscribe(handlers: SpeakerHandlers): () => void;
}

/** End the stream after this long with no conversation (billed per minute). */
const IDLE_STOP_MS = 5 * 60_000;
/** A reply the persona never starts speaking is given up on after this. */
const SPEAK_START_TIMEOUT_MS = 12_000;
/** Japanese phrase boundaries: flush text to TTS here for natural prosody. */
const PHRASE_END = /[。、！？!?\n]/;
/**
 * Runs without punctuation are flushed at this length. Kept short: Anam's TTS
 * buffers for prosody itself, and its start-up (~1.5s measured) dominates, so
 * holding text back for a clause boundary only adds delay.
 */
const MAX_BUFFER_CHARS = 8;

export function useAnamPersona({ labId }: { labId: string | null }) {
  const videoId = `anam-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<AnamStatus>("off");
  /** Autoplay with sound was blocked: the video plays muted until tapped. */
  const [needsTap, setNeedsTap] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<AnamClient | null>(null);
  const statusRef = useRef<AnamStatus>("off");
  /** Bumped on every start/stop, so a slow connect cannot revive a stopped session. */
  const generationRef = useRef(0);
  const handlersRef = useRef(new Set<SpeakerHandlers>());
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The connect in progress, so a second caller waits for it instead of failing. */
  const startingRef = useRef<Promise<boolean> | null>(null);

  // Current reply.
  const streamRef = useRef<TalkMessageStream | null>(null);
  /**
   * The reply being spoken, kept whole so it can be re-sent with `talk()` if
   * the engine fails to confirm its chunks (the SDK's documented recovery).
   */
  const replyRef = useRef<{ correlationId: string; text: string; complete: boolean; failed: boolean } | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const bufferRef = useRef("");
  const speakingRef = useRef(false);
  const startTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setStatusBoth = useCallback((next: AnamStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const emit = useCallback((pick: (h: SpeakerHandlers) => (() => void) | undefined) => {
    for (const h of handlersRef.current) pick(h)?.();
  }, []);

  const clearStartTimer = useCallback(() => {
    if (startTimer.current) clearTimeout(startTimer.current);
    startTimer.current = null;
  }, []);

  const speakingEnded = useCallback(() => {
    clearStartTimer();
    if (!speakingRef.current) return;
    speakingRef.current = false;
    emit((h) => h.onSpeakingEnd);
  }, [clearStartTimer, emit]);

  /** A reply she never starts speaking releases the UI instead of hanging on "thinking". */
  const armStartTimer = useCallback(() => {
    clearStartTimer();
    startTimer.current = setTimeout(() => {
      startTimer.current = null;
      if (!speakingRef.current) emit((h) => h.onSpeakingEnd);
    }, SPEAK_START_TIMEOUT_MS);
  }, [clearStartTimer, emit]);

  /** Re-sends a whole reply with `talk()` after a delivery failure (SDK-documented recovery). */
  const resend = useCallback(
    (text: string) => {
      const client = clientRef.current;
      replyRef.current = null;
      streamRef.current = null;
      if (!client || !text.trim()) return;
      // Some of it may already have been spoken; repeating beats silence.
      armStartTimer();
      void client.talk(text).catch(() => {
        setError("アバターへの送信に失敗しました。");
        clearStartTimer();
        emit((h) => h.onSpeakingEnd);
      });
    },
    [armStartTimer, clearStartTimer, emit],
  );

  const stop = useCallback(async () => {
    generationRef.current++;
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
    clearStartTimer();
    const client = clientRef.current;
    clientRef.current = null;
    streamRef.current = null;
    replyRef.current = null;
    bufferRef.current = "";
    if (speakingRef.current) {
      speakingRef.current = false;
      emit((h) => h.onSpeakingEnd);
    }
    setNeedsTap(false);
    if (statusRef.current === "connecting" || statusRef.current === "live") setStatusBoth("off");
    try {
      await client?.stopStreaming();
    } catch {
      /* already closed */
    }
  }, [clearStartTimer, emit, setStatusBoth]);

  /** Any conversation activity postpones the idle shutdown. */
  const touch = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    const schedule = () => {
      idleTimer.current = setTimeout(() => {
        // Never cut her off mid-sentence; check again later.
        if (speakingRef.current) return schedule();
        void stop().then(() => setStatusBoth("ended"));
      }, IDLE_STOP_MS);
    };
    schedule();
  }, [setStatusBoth, stop]);

  /** One connection attempt; resolves true once video frames are playing. */
  const connectStream = useCallback(async (): Promise<boolean> => {
    const generation = ++generationRef.current;
    const stale = () => generation !== generationRef.current;
    setError(null);
    setNeedsTap(false);
    setStatusBoth("connecting");

    try {
      const res = await fetch("/api/ai/avatar/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labId: labId ?? "" }),
      });
      const json = (await res.json().catch(() => ({}))) as { sessionToken?: string; error?: string };
      if (!res.ok || !json.sessionToken) throw new Error(json.error || `アバターに接続できませんでした（${res.status}）`);
      if (stale()) return false;

      const { createClient, AnamEvent } = await import("@anam-ai/js-sdk");
      if (stale()) return false;
      const client = createClient(json.sessionToken, {
        disableInputAudio: true,
        metrics: { disableClientMetrics: true },
      });
      clientRef.current = client;

      // Live = first video frame AND session ready. Chunks sent before the
      // session is ready can fail the stream on slower engines (SDK README).
      const live = new Promise<boolean>((resolve) => {
        let playing = false;
        let ready = false;
        const fail = setTimeout(() => resolve(false), 25_000);
        const check = () => {
          if (!playing || !ready) return;
          clearTimeout(fail);
          resolve(true);
        };
        client.addListener(AnamEvent.VIDEO_PLAY_STARTED, () => {
          playing = true;
          check();
        });
        client.addListener(AnamEvent.SESSION_READY, () => {
          ready = true;
          check();
        });
        client.addListener(AnamEvent.CONNECTION_CLOSED, () => {
          clearTimeout(fail);
          resolve(false);
        });
      });

      client.addListener(AnamEvent.VIDEO_STREAM_STARTED, () => {
        // The SDK emits this just *before* it assigns `srcObject`, and relies
        // on `autoplay`. Start playback ourselves on the next tick, once the
        // stream is attached, so a blocked autoplay falls back to muted video
        // (with a tap-to-unmute button) instead of a frozen frame.
        setTimeout(() => {
          const video = videoRef.current;
          if (!video || clientRef.current !== client) return;
          video.muted = false;
          void video.play().catch((err: unknown) => {
            // Only the autoplay policy is worth a muted fallback; an AbortError
            // just means playback was already (re)started by `autoplay`.
            if (!(err instanceof DOMException) || err.name !== "NotAllowedError") return;
            video.muted = true;
            setNeedsTap(true);
            void video.play().catch(() => {});
          });
        }, 0);
      });

      client.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, (ev) => {
        if (ev.role !== "persona" || clientRef.current !== client) return;
        if (!speakingRef.current && !ev.interrupted) {
          clearStartTimer();
          speakingRef.current = true;
          emit((h) => h.onSpeakingStart);
        }
        if (ev.endOfSpeech || ev.interrupted) speakingEnded();
        touch();
      });
      client.addListener(AnamEvent.TALK_STREAM_INTERRUPTED, (correlationId) => {
        if (clientRef.current !== client) return;
        // An answer the user cut off is never re-sent.
        if (replyRef.current?.correlationId === correlationId) replyRef.current = null;
        speakingEnded();
      });
      client.addListener(AnamEvent.MESSAGE_DELIVERY_FAILED, (failure) => {
        if (clientRef.current !== client) return;
        const reply = replyRef.current;
        if (!reply || reply.correlationId !== failure.correlationId) return;
        reply.failed = true;
        // Not finished yet: `end()` re-sends once the whole answer is known.
        if (reply.complete) resend(reply.text);
      });
      client.addListener(AnamEvent.CONNECTION_CLOSED, () => {
        if (clientRef.current !== client) return;
        clientRef.current = null;
        streamRef.current = null;
        speakingEnded();
        setNeedsTap(false);
        setStatusBoth("ended");
        emit((h) => h.onUnavailable);
      });

      await client.streamToVideoElement(videoId);
      const ok = await live;
      if (stale()) return false;
      if (!ok) throw new Error("アバターの映像を開始できませんでした。");
      setStatusBoth("live");
      touch();
      return true;
    } catch (e) {
      if (stale()) return false;
      const client = clientRef.current;
      clientRef.current = null;
      void client?.stopStreaming().catch(() => {});
      setError(e instanceof Error ? e.message : "アバターに接続できませんでした。");
      setStatusBoth("failed");
      emit((h) => h.onUnavailable);
      return false;
    }
  }, [clearStartTimer, emit, labId, resend, setStatusBoth, speakingEnded, touch, videoId]);

  /** Connects the stream, or joins the connect already in progress. */
  const start = useCallback((): Promise<boolean> => {
    if (statusRef.current === "live") return Promise.resolve(true);
    if (startingRef.current) return startingRef.current;
    const attempt = connectStream().finally(() => {
      if (startingRef.current === attempt) startingRef.current = null;
    });
    startingRef.current = attempt;
    return attempt;
  }, [connectStream]);

  /** Tap-to-unmute after a blocked autoplay. */
  const unmute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    void video.play().then(
      () => setNeedsTap(false),
      () => {},
    );
  }, []);

  useEffect(
    () => () => {
      void stop();
    },
    [stop],
  );

  const speaker = useMemo<AvatarSpeaker>(() => {
    /** Sends text to the current talk stream, in order. */
    const send = (text: string, last: boolean) => {
      const stream = streamRef.current;
      if (!stream) return;
      queueRef.current = queueRef.current
        .then(async () => {
          if (!stream.isActive()) return;
          if (text) await stream.streamMessageChunk(text, last);
          else if (last) await stream.endMessage();
        })
        .catch(() => {
          /* stream interrupted or closed - the next reply opens a new one */
        });
    };

    const flush = (last: boolean) => {
      const text = bufferRef.current;
      bufferRef.current = "";
      send(text, last);
    };

    const begin = () => {
      const client = clientRef.current;
      if (!client || statusRef.current !== "live") return;
      // A reply still being spoken is replaced, not queued.
      if (streamRef.current?.isActive()) {
        try {
          client.interruptPersona();
        } catch {
          /* nothing to interrupt */
        }
      }
      bufferRef.current = "";
      const stream = client.createTalkMessageStream();
      streamRef.current = stream;
      replyRef.current = { correlationId: stream.getCorrelationId(), text: "", complete: false, failed: false };
      armStartTimer();
      touch();
    };

    const push = (text: string) => {
      if (!streamRef.current || !text) return;
      // Kept whole even if the stream fails, for the talk() fallback.
      if (replyRef.current) replyRef.current.text += text;
      bufferRef.current += text;
      const buffered = bufferRef.current;
      if (PHRASE_END.test(text) || [...buffered].length >= MAX_BUFFER_CHARS) flush(false);
    };

    const end = () => {
      if (!streamRef.current) return;
      flush(true);
      const reply = replyRef.current;
      if (!reply) return;
      reply.complete = true;
      if (reply.failed) resend(reply.text);
    };

    return {
      isLive: () => statusRef.current === "live" && clientRef.current !== null,
      begin,
      push,
      end,
      say(text: string) {
        begin();
        push(text);
        end();
      },
      interrupt() {
        const client = clientRef.current;
        bufferRef.current = "";
        streamRef.current = null;
        replyRef.current = null;
        if (client) {
          try {
            client.interruptPersona();
          } catch {
            /* not streaming */
          }
        }
        speakingEnded();
        touch();
      },
      subscribe(handlers) {
        handlersRef.current.add(handlers);
        return () => {
          handlersRef.current.delete(handlers);
        };
      },
    };
  }, [armStartTimer, resend, speakingEnded, touch]);

  return { status, error, needsTap, videoId, videoRef, start, stop, unmute, touch, speaker };
}
