"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeSpeechAudio,
  emptyFrame,
  sampleTrack,
  textVisemeTrack,
  type TextVisemeTrack,
  type VisemeFrame,
  type VisemeTrack,
} from "@/lib/voice/lipSync";
import { planPerformance, type PerformancePlan } from "@/lib/avatar/planner";
import type { AssistantPerformance } from "@/lib/avatar/protocol";
import { encodeVisemeTrack } from "@/lib/avatar/encode";
import { speakJapanese, stopSpeaking } from "./useChatbotConversation";
import type { AvatarController } from "./avatar/useAvatarController";

/**
 * Lips lead the sound slightly: the mouth shapes a vowel just before it is
 * heard, and lagging lips are far more noticeable than leading ones.
 */
const LIP_LEAD_SECONDS = 0.045;

export type VoiceSource = "unreal" | "neural" | "browser" | null;

/** Read every animation frame by the avatar; never triggers React renders. */
export interface LipSyncSource {
  sample(out: VisemeFrame): VisemeFrame;
  isSpeaking(): boolean;
  /** Seconds into the current utterance on its own clock, or -1. */
  time(): number;
}

type Playback =
  | { kind: "audio"; track: VisemeTrack; source: AudioBufferSourceNode; startedAt: number }
  /** `startedAt` stays 0 until the utterance actually starts. */
  | { kind: "browser"; track: TextVisemeTrack; startedAt: number }
  /** Unreal plays the audio; the browser only keeps time for the photo/3D fallback. */
  | { kind: "remote"; track: VisemeTrack; startedAt: number };

/** One sentence tagged "friendly" when the model gave no performance. */
function defaultPerformance(text: string): AssistantPerformance {
  return { segments: [{ speech: text, emotion: "friendly", gesture: "none", intensity: 0.3 }] };
}

/**
 * Speaks assistant replies and drives the avatar.
 *
 * TTS → phoneme/viseme extraction → avatar, in three output modes:
 *
 * 1. `unreal`  - a MetaHuman is connected over Pixel Streaming: WAV audio,
 *    the cue plan and fallback visemes are streamed to Unreal, which plays
 *    the sound inside the WebRTC stream (Audio2Face drives the face there).
 * 2. `neural`  - neural TTS played through Web Audio; visemes are analysed
 *    from the decoded waveform and sampled on the audio clock.
 * 3. `browser` - OS speech synthesis with a text-estimated viseme track, when
 *    the TTS endpoint is unavailable.
 *
 * In every mode the cue plan is built against the utterance's real (or best
 * estimated) duration and handed to the avatar controller.
 */
export function useAssistantVoice(labId: string | null, avatar?: AvatarController) {
  const [speaking, setSpeaking] = useState(false);
  const [source, setSource] = useState<VoiceSource>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const playRef = useRef<Playback | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const tokenRef = useRef(0);
  const avatarRef = useRef(avatar);
  useEffect(() => {
    avatarRef.current = avatar;
  }, [avatar]);

  /**
   * Creates/resumes the AudioContext. Call synchronously inside the click or
   * key handler that leads to a reply, so autoplay policy allows playback
   * after the chat request resolves.
   */
  const prime = useCallback(() => {
    if (typeof window === "undefined" || !("AudioContext" in window)) return;
    ctxRef.current ??= new AudioContext();
    if (ctxRef.current.state === "suspended") void ctxRef.current.resume();
  }, []);

  const finish = useCallback((playback: Playback) => {
    if (playRef.current !== playback) return;
    playRef.current = null;
    setSpeaking(false);
    avatarRef.current?.utteranceEnded();
  }, []);

  const stop = useCallback(() => {
    tokenRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    const p = playRef.current;
    playRef.current = null;
    if (p?.kind === "audio") {
      p.source.onended = null;
      try {
        p.source.stop();
      } catch {
        /* already stopped */
      }
    }
    if (p?.kind === "remote") avatarRef.current?.remote()?.send({ type: "stop", reason: "interrupted" });
    stopSpeaking();
    setSpeaking(false);
    if (p) avatarRef.current?.utteranceEnded();
  }, []);

  const speakWithBrowser = useCallback(
    (text: string, performance: AssistantPerformance, token: number) => {
      if (typeof window === "undefined" || !window.speechSynthesis) {
        avatarRef.current?.dispatch({ type: "REPLY_FAILED" });
        return;
      }
      const track = textVisemeTrack(text);
      const plan = planPerformance(performance, track.duration);
      const playback: Extract<Playback, { kind: "browser" }> = {
        kind: "browser",
        track,
        startedAt: 0,
      };
      const current = () => tokenRef.current === token && playRef.current === playback;
      const now = () => performance_now() / 1000;

      playRef.current = playback;
      setSource("browser");
      setSpeaking(true);
      speakJapanese(text, {
        onStart: () => {
          if (!current()) return;
          playback.startedAt = now();
          avatarRef.current?.utteranceStarted(plan);
        },
        onBoundary: (charIndex) => {
          if (!current() || !playback.startedAt) return;
          // Re-anchor the estimated clock on the voice's real position. Move
          // halfway so a jump does not visibly skip mouth shapes.
          const expected = track.charTimes[Math.min(charIndex, track.charTimes.length - 1)];
          const drift = now() - playback.startedAt - expected;
          if (Math.abs(drift) > 0.06) playback.startedAt += drift * 0.5;
        },
        onEnd: () => {
          if (current()) finish(playback);
        },
      });
    },
    [finish],
  );

  const fetchSpeech = useCallback(
    async (text: string, format: "mp3" | "wav", signal: AbortSignal) => {
      const res = await fetch("/api/ai/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({ labId: labId ?? "", text, format }),
      });
      if (!res.ok) throw new Error(`speech ${res.status}`);
      return res.arrayBuffer();
    },
    [labId],
  );

  const speak = useCallback(
    async (text: string, performanceIn?: AssistantPerformance | null) => {
      const content = text.trim();
      stop();
      if (!content) return;
      const token = tokenRef.current;
      const performance =
        performanceIn && performanceIn.segments.length > 0 ? performanceIn : defaultPerformance(content);
      prime();
      const ctx = ctxRef.current;
      const ac = new AbortController();
      abortRef.current = ac;
      const stale = () => tokenRef.current !== token;

      try {
        /* 1. Unreal / MetaHuman over Pixel Streaming. */
        const remote = avatarRef.current?.remote();
        if (remote && ctx) {
          try {
            const bytes = await fetchSpeech(content, "wav", ac.signal);
            // decodeAudioData detaches its input; keep the original for Unreal.
            const buffer = await ctx.decodeAudioData(bytes.slice(0));
            if (stale()) return;
            const track = analyzeSpeechAudio(buffer);
            const plan = planPerformance(performance, buffer.duration);
            const playback: Extract<Playback, { kind: "remote" }> = {
              kind: "remote",
              track,
              startedAt: performance_now() / 1000,
            };
            playRef.current = playback;
            setSource("unreal");
            setSpeaking(true);
            avatarRef.current?.utteranceStarted(plan);
            await remote.speak({
              wav: new Uint8Array(bytes),
              durationSec: buffer.duration,
              text: content,
              plan,
              visemes: encodeVisemeTrack(track),
              signal: ac.signal,
            });
            if (!stale()) finish(playback);
            return;
          } catch (e) {
            if (stale() || (e instanceof Error && e.name === "AbortError")) return;
            // Fall through to local playback.
          }
        }

        /* 2. Neural TTS in the browser. */
        if (ctx) {
          try {
            const bytes = await fetchSpeech(content, "mp3", ac.signal);
            const buffer = await ctx.decodeAudioData(bytes);
            if (stale()) return;

            const track = analyzeSpeechAudio(buffer);
            const plan = planPerformance(performance, buffer.duration);
            const node = ctx.createBufferSource();
            node.buffer = buffer;
            node.connect(ctx.destination);
            if (ctx.state === "suspended") await ctx.resume();
            if (stale()) return;
            // Start a hair in the future so `startedAt` is exact, not "about now".
            const startedAt = ctx.currentTime + 0.05;
            node.start(startedAt);
            const playback: Extract<Playback, { kind: "audio" }> = { kind: "audio", track, source: node, startedAt };
            node.onended = () => finish(playback);
            playRef.current = playback;
            setSource("neural");
            setSpeaking(true);
            avatarRef.current?.utteranceStarted(plan);
            return;
          } catch (e) {
            if (stale() || (e instanceof Error && e.name === "AbortError")) return;
            // Fall through to browser speech.
          }
        }

        /* 3. Browser speech synthesis. */
        if (!stale()) speakWithBrowser(content, performance, token);
      } finally {
        if (abortRef.current === ac) abortRef.current = null;
      }
    },
    [fetchSpeech, finish, prime, speakWithBrowser, stop],
  );

  useEffect(
    () => () => {
      stop();
      void ctxRef.current?.close();
      ctxRef.current = null;
    },
    [stop],
  );

  const lipSync = useMemo<LipSyncSource>(() => {
    const time = (): number => {
      const p = playRef.current;
      if (!p) return -1;
      if (p.kind === "audio") {
        const ctx = ctxRef.current;
        if (!ctx) return -1;
        // outputLatency: time from the audio clock to the speaker.
        const latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
        return ctx.currentTime - p.startedAt - latency;
      }
      if (!p.startedAt) return -1;
      return performance_now() / 1000 - p.startedAt;
    };
    return {
      isSpeaking: () => playRef.current !== null,
      time,
      sample(out) {
        const p = playRef.current;
        const t = time();
        if (!p || t < 0) return sampleTrack(EMPTY_TRACK, -1, out);
        if (p.kind === "audio") return sampleTrack(p.track, t + LIP_LEAD_SECONDS, out);
        if (p.kind === "remote") return sampleTrack(p.track, t, out);
        // Browser speech rarely matches the estimated rate exactly; loop the
        // tail softly rather than freezing the mouth if it runs long.
        const d = p.track.duration;
        const looped = t < d ? t : d * 0.6 + ((t - d) % (d * 0.4));
        return sampleTrack(p.track, looped, out);
      },
    };
  }, []);

  return { speak, stop, prime, speaking, source, lipSync };
}

/** `performance` is shadowed by the avatar performance in this module. */
function performance_now(): number {
  return globalThis.performance.now();
}

export type { PerformancePlan };

const EMPTY_TRACK: VisemeTrack = (() => {
  const f = emptyFrame();
  return { fps: 60, duration: 0, weights: f.weights, energy: new Float32Array(1) };
})();
