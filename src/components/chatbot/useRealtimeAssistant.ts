"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appendChatMessage, clearChatHistory, loadChatHistory } from "@/lib/chatbot/historyStore";
import { createAnalyserLipSync, type LiveLipSync } from "@/lib/voice/liveLipSync";
import type { VisemeFrame } from "@/lib/voice/lipSync";
import type { AvatarController } from "./avatar/useAvatarController";
import type { ChatbotMessage } from "./useChatbotConversation";

/**
 * Live voice conversation with the assistant over OpenAI's realtime API.
 *
 * The browser streams the microphone straight to the speech-to-speech model
 * over WebRTC (a short-lived key comes from `/api/ai/realtime`). The model
 * detects when the user stops talking and transcribes the question; the
 * transcript goes to `/api/ai/answer` (~70ms), which either returns a cached
 * answer - replayed with no model call - or the few knowledge snippets the
 * model needs to answer live. Tokens are spent only on questions nobody has
 * asked before.
 *
 * Turn taking matches the UI: press the mic to talk; the moment the model
 * hears the end of the utterance the mic mutes itself and the reply plays.
 * Press the mic again for the next question (pressing it while the assistant
 * talks interrupts her).
 */

export type AssistantStatus = "idle" | "connecting" | "ready" | "listening" | "thinking" | "speaking";

const HISTORY_MODE = "voice";
/** Recent turns replayed into a new session so the conversation continues. */
const CONTEXT_TURNS = 10;
/** Give up listening if the user says nothing at all for this long. */
const NO_SPEECH_MS = 8000;

type ServerEvent = { type: string; [key: string]: unknown };

type AnswerDecision = { hit?: boolean; answer?: string; audioUrl?: string; instructions?: string };

/** Audio element routed through an analyser, for replaying cached answers with lip sync. */
function createReplay(ctx: AudioContext, speaking: () => boolean, startedAt: () => number) {
  const element = new Audio();
  element.preload = "auto";
  const analyser = ctx.createAnalyser();
  ctx.createMediaElementSource(element).connect(analyser);
  analyser.connect(ctx.destination);
  return { element, lipSync: createAnalyserLipSync(analyser, speaking, startedAt) };
}

function playReplay(
  element: HTMLAudioElement,
  src: string,
  handlers: { onPlaying: () => void; onEnded: () => void; onFailed: () => void },
) {
  let started = false;
  element.onplaying = () => {
    if (started) return;
    started = true;
    handlers.onPlaying();
  };
  element.onended = handlers.onEnded;
  element.onerror = () => {
    if (!started) handlers.onFailed();
  };
  element.src = src;
  void element.play().catch(() => {
    if (!started) handlers.onFailed();
  });
}

function createPlaybackElement() {
  const el = new Audio();
  el.autoplay = true;
  return el;
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function useRealtimeAssistant({
  labId,
  historyScope,
  avatar,
}: {
  labId: string | null;
  historyScope: string;
  avatar: AvatarController;
}) {
  const [status, setStatus] = useState<AssistantStatus>("idle");
  const [messages, setMessages] = useState<ChatbotMessage[]>([]);
  /** The user's words while they are still speaking (live caption). */
  const [liveCaption, setLiveCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Milliseconds from end of the user's speech to the first reply audio. */
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const senderRef = useRef<RTCRtpSender | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const liveRef = useRef<LiveLipSync | null>(null);
  /** Replay of a cached answer: its own element + analyser for lip sync. */
  const replayElRef = useRef<HTMLAudioElement | null>(null);
  const replayLipRef = useRef<LiveLipSync | null>(null);
  const replayingRef = useRef(false);
  const lastQuestionRef = useRef("");
  /** Signed session token from /api/ai/realtime: fast cache lookups. */
  const answerTokenRef = useRef("");
  const connectingRef = useRef<Promise<boolean> | null>(null);
  const statusRef = useRef<AssistantStatus>("idle");
  const speechActiveRef = useRef(false);
  const speakingRef = useRef(false);
  const speakStartRef = useRef(0);
  const turnEndedAtRef = useRef(0);
  const noSpeechTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** item_id -> message id, so transcripts land in the right bubble. */
  const itemToMessage = useRef(new Map<string, string>());
  const messagesRef = useRef<ChatbotMessage[]>([]);
  const avatarRef = useRef(avatar);

  useEffect(() => {
    avatarRef.current = avatar;
  }, [avatar]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const setStatusBoth = useCallback((next: AssistantStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  /* ---- history ---- */
  useEffect(() => {
    let cancelled = false;
    void loadChatHistory(historyScope, HISTORY_MODE).then((stored) => {
      if (cancelled || stored.length === 0) return;
      setMessages((current) => {
        const seen = new Set(current.map((m) => m.id));
        const restored = stored
          .filter((m) => !seen.has(m.id))
          .map(({ id, role, content, createdAt }) => ({ id, role, content, createdAt }));
        return [...restored, ...current];
      });
    });
    return () => {
      cancelled = true;
    };
  }, [historyScope]);

  const upsert = useCallback(
    (id: string, role: ChatbotMessage["role"], update: (prev: string) => string, persist = false) => {
      setMessages((prev) => {
        const i = prev.findIndex((m) => m.id === id);
        const next =
          i >= 0
            ? prev.map((m, k) => (k === i ? { ...m, content: update(m.content) } : m))
            : [...prev, { id, role, content: update(""), createdAt: Date.now() }];
        if (persist) {
          const m = next.find((x) => x.id === id);
          if (m && m.content.trim()) void appendChatMessage({ ...m, scope: historyScope, mode: HISTORY_MODE });
        }
        return next;
      });
    },
    [historyScope],
  );

  /* ---- lip sync (stable object; the analyser appears once connected) ---- */
  const lipSync = useMemo(
    () => ({
      sample(out: VisemeFrame) {
        const live = replayingRef.current && replayLipRef.current ? replayLipRef.current : liveRef.current;
        if (live) return live.sample(out);
        out.weights.fill(0);
        out.weights[0] = 1;
        out.energy = 0;
        return out;
      },
      isSpeaking: () => speakingRef.current,
      time: () => (speakingRef.current ? performance.now() / 1000 - speakStartRef.current : -1),
    }),
    [],
  );

  /* ---- mic ---- */
  const clearNoSpeech = useCallback(() => {
    if (noSpeechTimer.current) clearTimeout(noSpeechTimer.current);
    noSpeechTimer.current = null;
  }, []);

  const muteMic = useCallback(() => {
    clearNoSpeech();
    micRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = false;
    });
  }, [clearNoSpeech]);

  const send = useCallback((event: Record<string, unknown>) => {
    const dc = dcRef.current;
    if (dc?.readyState === "open") dc.send(JSON.stringify(event));
  }, []);

  /* ---- answering: cache first, model on a miss ---- */

  /** Stops a cached answer that is playing (interruptions, clear, close). */
  const stopReplay = useCallback(() => {
    if (!replayingRef.current) return;
    replayElRef.current?.pause();
    replayingRef.current = false;
    speakingRef.current = false;
    avatarRef.current.dispatch({ type: "SPEECH_FINISHED" });
  }, []);

  /** Asks the realtime model to answer the question already in the conversation. */
  const respondLive = useCallback(
    (instructions?: string) => {
      send(instructions ? { type: "response.create", response: { instructions } } : { type: "response.create" });
    },
    [send],
  );

  /**
   * One question -> the cheapest possible answer. If an equivalent question
   * was answered before, its stored text and voice are replayed with no model
   * call at all; otherwise the realtime model answers with only the knowledge
   * snippets relevant to this question attached.
   */
  const answerQuestion = useCallback(
    async (question: string) => {
      const previousQuestion = lastQuestionRef.current;
      lastQuestionRef.current = question;
      let decision: AnswerDecision = {};
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 4000);
        const res = await fetch("/api/ai/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ labId: labId ?? "", question, previousQuestion, token: answerTokenRef.current }),
          signal: ac.signal,
        });
        clearTimeout(timer);
        if (res.ok) decision = (await res.json()) as AnswerDecision;
      } catch {
        // Lookup unavailable: the model still answers, with the session persona.
      }

      const ctx = ctxRef.current;
      const { answer, audioUrl, instructions } = decision;
      if (!decision.hit || !answer || !audioUrl || !ctx) {
        respondLive(instructions);
        return;
      }

      if (!replayElRef.current) {
        const replay = createReplay(ctx, () => speakingRef.current, () => (replayingRef.current ? speakStartRef.current : 0));
        replayElRef.current = replay.element;
        replayLipRef.current = replay.lipSync;
      }
      const av = avatarRef.current;
      // Keep the model's context in step, so a follow-up question still makes sense.
      send({
        type: "conversation.item.create",
        item: { type: "message", role: "assistant", content: [{ type: "output_text", text: answer }] },
      });
      playReplay(replayElRef.current, audioUrl, {
        onPlaying: () => {
          replayingRef.current = true;
          speakingRef.current = true;
          speakStartRef.current = performance.now() / 1000;
          if (turnEndedAtRef.current) {
            setLastLatencyMs(Math.round(performance.now() - turnEndedAtRef.current));
            turnEndedAtRef.current = 0;
          }
          upsert(newId(), "assistant", () => answer, true);
          setStatusBoth("speaking");
          av.dispatch({ type: "SPEECH_STARTED" });
        },
        onEnded: () => {
          replayingRef.current = false;
          speakingRef.current = false;
          if (statusRef.current === "speaking") setStatusBoth("ready");
          av.dispatch({ type: "SPEECH_FINISHED" });
        },
        // Stored audio unavailable: fall back to a live answer.
        onFailed: () => respondLive(instructions),
      });
    },
    [labId, respondLive, send, setStatusBoth, upsert],
  );

  /* ---- server events ---- */
  const onServerEvent = useCallback(
    (ev: ServerEvent) => {
      const av = avatarRef.current;
      switch (ev.type) {
        case "input_audio_buffer.speech_started": {
          clearNoSpeech();
          speechActiveRef.current = true;
          av.userActivity();
          break;
        }
        case "input_audio_buffer.speech_stopped": {
          // End of the user's turn: mute right away, the reply is on its way.
          speechActiveRef.current = false;
          turnEndedAtRef.current = performance.now();
          muteMic();
          const itemId = String(ev.item_id ?? "");
          if (itemId && !itemToMessage.current.has(itemId)) {
            const id = newId();
            itemToMessage.current.set(itemId, id);
            upsert(id, "user", () => "…");
          }
          setStatusBoth("thinking");
          av.dispatch({ type: "REQUEST_SENT" });
          break;
        }
        case "conversation.item.input_audio_transcription.delta": {
          const delta = String(ev.delta ?? "");
          setLiveCaption((c) => c + delta);
          break;
        }
        case "conversation.item.input_audio_transcription.completed": {
          const itemId = String(ev.item_id ?? "");
          const text = String(ev.transcript ?? "").trim();
          let id = itemToMessage.current.get(itemId);
          if (!id) {
            id = newId();
            itemToMessage.current.set(itemId, id);
          }
          setLiveCaption("");
          if (text) {
            upsert(id, "user", () => text, true);
            void answerQuestion(text);
          } else {
            setMessages((prev) => prev.filter((m) => m.id !== id));
            setStatusBoth("ready");
            av.dispatch({ type: "REPLY_FAILED" });
          }
          break;
        }
        case "conversation.item.input_audio_transcription.failed": {
          // No text to look up; the model can still answer from the audio itself.
          setLiveCaption("");
          respondLive();
          break;
        }
        case "response.output_audio_transcript.delta": {
          const itemId = String(ev.item_id ?? "");
          let id = itemToMessage.current.get(itemId);
          if (!id) {
            id = newId();
            itemToMessage.current.set(itemId, id);
          }
          const delta = String(ev.delta ?? "");
          upsert(id, "assistant", (prev) => prev + delta);
          break;
        }
        case "response.output_audio_transcript.done": {
          const itemId = String(ev.item_id ?? "");
          const id = itemToMessage.current.get(itemId);
          const text = String(ev.transcript ?? "");
          if (id) upsert(id, "assistant", (prev) => text || prev, true);
          break;
        }
        case "output_audio_buffer.started": {
          speakingRef.current = true;
          speakStartRef.current = performance.now() / 1000;
          if (turnEndedAtRef.current) {
            setLastLatencyMs(Math.round(performance.now() - turnEndedAtRef.current));
            turnEndedAtRef.current = 0;
          }
          setStatusBoth("speaking");
          av.dispatch({ type: "SPEECH_STARTED" });
          break;
        }
        case "output_audio_buffer.stopped":
        case "output_audio_buffer.cleared": {
          speakingRef.current = false;
          if (statusRef.current === "speaking") setStatusBoth("ready");
          av.dispatch({ type: "SPEECH_FINISHED" });
          break;
        }
        case "response.done": {
          const response = ev.response as { status?: string; status_details?: { error?: { message?: string } } } | undefined;
          if (response?.status === "failed") {
            setError(response.status_details?.error?.message ?? "応答の生成に失敗しました。");
            av.dispatch({ type: "REPLY_FAILED" });
            if (statusRef.current === "thinking") setStatusBoth("ready");
          } else if (statusRef.current === "thinking" && !speakingRef.current) {
            // Text-only or empty response: nothing will play.
            setStatusBoth("ready");
            av.dispatch({ type: "REPLY_FAILED" });
          }
          break;
        }
        case "error": {
          const err = ev.error as { message?: string; code?: string } | undefined;
          // Cancelling when nothing is playing is harmless.
          if (err?.code === "response_cancel_not_active") break;
          setError(err?.message ?? "音声会話でエラーが発生しました。");
          break;
        }
      }
    },
    [answerQuestion, clearNoSpeech, muteMic, respondLive, setStatusBoth, upsert],
  );
  // The data channel outlives re-renders; always dispatch to the latest handler.
  const onServerEventRef = useRef(onServerEvent);
  useEffect(() => {
    onServerEventRef.current = onServerEvent;
  }, [onServerEvent]);

  /* ---- connection ---- */
  const disconnect = useCallback(() => {
    clearNoSpeech();
    dcRef.current?.close();
    pcRef.current?.close();
    micRef.current?.getTracks().forEach((t) => t.stop());
    if (audioElRef.current) audioElRef.current.srcObject = null;
    void ctxRef.current?.close();
    dcRef.current = null;
    pcRef.current = null;
    senderRef.current = null;
    micRef.current = null;
    ctxRef.current = null;
    liveRef.current = null;
    // The replay element is bound to the (now closed) AudioContext.
    replayElRef.current?.pause();
    replayElRef.current = null;
    replayLipRef.current = null;
    replayingRef.current = false;
    connectingRef.current = null;
    speakingRef.current = false;
    speechActiveRef.current = false;
    itemToMessage.current.clear();
  }, [clearNoSpeech]);

  const connect = useCallback((): Promise<boolean> => {
    if (pcRef.current && dcRef.current?.readyState === "open") return Promise.resolve(true);
    if (connectingRef.current) return connectingRef.current;

    // Created inside the click that started this, so playback is allowed.
    const ctx = ctxRef.current ?? new AudioContext();
    ctxRef.current = ctx;
    void ctx.resume();
    const audioEl = audioElRef.current ?? createPlaybackElement();
    audioElRef.current = audioEl;

    setError(null);
    setStatusBoth("connecting");

    const attempt = (async () => {
      try {
        const res = await fetch("/api/ai/realtime", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ labId: labId ?? "" }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          clientSecret?: string;
          model?: string;
          answerToken?: string;
          error?: string;
        };
        if (!res.ok || !json.clientSecret) throw new Error(json.error || `接続に失敗しました（${res.status}）`);
        answerTokenRef.current = json.answerToken ?? "";

        const pc = new RTCPeerConnection();
        pcRef.current = pc;
        pc.ontrack = (e) => {
          const [stream] = e.streams;
          audioEl.srcObject = stream;
          void audioEl.play().catch(() => {});
          const analyser = ctx.createAnalyser();
          ctx.createMediaStreamSource(stream).connect(analyser);
          liveRef.current = createAnalyserLipSync(
            analyser,
            () => speakingRef.current,
            () => (speakingRef.current ? speakStartRef.current : 0),
          );
        };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "failed" || pc.connectionState === "closed") {
            if (pcRef.current === pc) {
              disconnect();
              setStatusBoth("idle");
            }
          }
        };

        const mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        mic.getAudioTracks().forEach((t) => {
          t.enabled = false; // muted until the user presses the mic
        });
        micRef.current = mic;
        senderRef.current = pc.addTrack(mic.getAudioTracks()[0], mic);

        const dc = pc.createDataChannel("oai-events");
        dcRef.current = dc;
        dc.onmessage = (e) => {
          try {
            onServerEventRef.current(JSON.parse(e.data) as ServerEvent);
          } catch {
            /* ignore malformed frames */
          }
        };
        const opened = new Promise<void>((resolve, reject) => {
          dc.onopen = () => resolve();
          setTimeout(() => reject(new Error("音声会話への接続がタイムアウトしました。")), 20_000);
        });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
          method: "POST",
          body: offer.sdp,
          headers: { Authorization: `Bearer ${json.clientSecret}`, "Content-Type": "application/sdp" },
        });
        if (!sdpRes.ok) throw new Error(`音声会話に接続できませんでした（${sdpRes.status}）`);
        await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });
        await opened;

        // Continue the conversation the user already sees on screen.
        for (const m of messagesRef.current.slice(-CONTEXT_TURNS)) {
          if (!m.content.trim() || m.content === "…") continue;
          send({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: m.role,
              content: [{ type: m.role === "user" ? "input_text" : "output_text", text: m.content }],
            },
          });
        }
        setStatusBoth("ready");
        return true;
      } catch (e) {
        disconnect();
        setStatusBoth("idle");
        const name = e instanceof DOMException ? e.name : "";
        setError(
          name === "NotAllowedError"
            ? "マイクの使用を許可してください。"
            : e instanceof Error
              ? e.message
              : "音声会話に接続できませんでした。",
        );
        return false;
      } finally {
        connectingRef.current = null;
      }
    })();
    connectingRef.current = attempt;
    return attempt;
  }, [disconnect, labId, send, setStatusBoth]);

  /* ---- user actions ---- */
  const startListening = useCallback(async () => {
    const av = avatarRef.current;
    // Interrupting: stop her voice before opening the mic.
    if (speakingRef.current) {
      stopReplay();
      send({ type: "response.cancel" });
      send({ type: "output_audio_buffer.clear" });
    }
    av.dispatch({ type: "USER_STARTED" });
    if (!(await connect())) {
      av.dispatch({ type: "USER_STOPPED" });
      return;
    }
    setError(null);
    setLiveCaption("");
    send({ type: "input_audio_buffer.clear" });
    micRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = true;
    });
    setStatusBoth("listening");
    clearNoSpeech();
    noSpeechTimer.current = setTimeout(() => {
      if (statusRef.current !== "listening" || speechActiveRef.current) return;
      muteMic();
      setStatusBoth("ready");
      av.dispatch({ type: "USER_STOPPED" });
      setError("声が聞こえませんでした。もう一度マイクを押して話してください。");
    }, NO_SPEECH_MS);
  }, [clearNoSpeech, connect, muteMic, send, setStatusBoth, stopReplay]);

  /** Mic pressed again while listening: end the turn now. */
  const stopListening = useCallback(() => {
    const av = avatarRef.current;
    muteMic();
    if (speechActiveRef.current) {
      speechActiveRef.current = false;
      turnEndedAtRef.current = performance.now();
      // Committing triggers transcription; its completion runs the cache lookup.
      send({ type: "input_audio_buffer.commit" });
      setStatusBoth("thinking");
      av.dispatch({ type: "REQUEST_SENT" });
    } else {
      setStatusBoth("ready");
      av.dispatch({ type: "USER_STOPPED" });
    }
  }, [muteMic, send, setStatusBoth]);

  const sendText = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      const av = avatarRef.current;
      if (speakingRef.current) {
        stopReplay();
        send({ type: "response.cancel" });
        send({ type: "output_audio_buffer.clear" });
      }
      if (!(await connect())) return;
      muteMic();
      const id = newId();
      upsert(id, "user", () => text, true);
      send({
        type: "conversation.item.create",
        item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
      });
      turnEndedAtRef.current = performance.now();
      setStatusBoth("thinking");
      av.dispatch({ type: "REQUEST_SENT" });
      await answerQuestion(text);
    },
    [answerQuestion, connect, muteMic, send, setStatusBoth, stopReplay, upsert],
  );

  const clear = useCallback(() => {
    if (speakingRef.current) {
      stopReplay();
      send({ type: "response.cancel" });
      send({ type: "output_audio_buffer.clear" });
    }
    setMessages([]);
    setLiveCaption("");
    setError(null);
    void clearChatHistory(historyScope, HISTORY_MODE);
    // A fresh session so the model forgets the cleared turns too.
    disconnect();
    setStatusBoth("idle");
  }, [disconnect, historyScope, send, setStatusBoth, stopReplay]);

  const close = useCallback(() => {
    disconnect();
    setLiveCaption("");
    setStatusBoth("idle");
  }, [disconnect, setStatusBoth]);

  useEffect(() => disconnect, [disconnect]);

  return {
    status,
    messages,
    liveCaption,
    error,
    lastLatencyMs,
    lipSync,
    startListening,
    stopListening,
    sendText,
    clear,
    close,
  };
}
