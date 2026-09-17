"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/components/workspace";
import type { AssistantPerformance } from "@/lib/avatar/protocol";
import {
  appendChatMessage,
  clearChatHistory,
  loadChatHistory,
} from "@/lib/chatbot/historyStore";

export type ChatbotMode = "voice" | "video";

export type ChatbotMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

/** Turns sent to the model per request; the full history stays local. */
const CONTEXT_TURNS = 24;

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Shared turn state for the floating voice / video chatbots.
 *
 * `labId` prefers the workspace experiment's lab, then falls back to a
 * caller-supplied default (usually the signed-in user's sole lab). Guests
 * pass no lab and are still answered (rate limited on the server).
 *
 * Every turn is persisted to IndexedDB under `historyScope` (the account, or
 * "guest") as soon as it exists, and the thread is restored on mount.
 */
export function useChatbotConversation(
  mode: ChatbotMode,
  fallbackLabId: string | null,
  historyScope = "guest",
) {
  const ws = useWorkspace();
  const [messages, setMessages] = useState<ChatbotMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Read by `send` without re-creating it; written where the state changes.
  const pendingRef = useRef(false);
  const messagesRef = useRef<ChatbotMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const labId = ws.labId ?? fallbackLabId;

  // A different account (sign-in / sign-out) is a different thread: drop the
  // on-screen one during render, then the effect below restores the new one.
  const [loadedScope, setLoadedScope] = useState(historyScope);
  if (loadedScope !== historyScope) {
    setLoadedScope(historyScope);
    setMessages([]);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    void loadChatHistory(historyScope, mode).then((stored) => {
      if (cancelled || stored.length === 0) return;
      setMessages((current) => {
        // Turns typed before the load finished are already persisted too;
        // merge by id so neither copy is lost or duplicated.
        const seen = new Set(stored.map((m) => m.id));
        const restored = stored.map(({ id, role, content, createdAt }) => ({ id, role, content, createdAt }));
        return [...restored, ...current.filter((m) => !seen.has(m.id))];
      });
    });
    return () => {
      cancelled = true;
    };
  }, [historyScope, mode]);

  const persist = useCallback(
    (m: ChatbotMessage) => {
      void appendChatMessage({ ...m, scope: historyScope, mode });
    },
    [historyScope, mode],
  );

  const clear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setError(null);
    setPending(false);
    pendingRef.current = false;
    messagesRef.current = [];
    void clearChatHistory(historyScope, mode);
  }, [historyScope, mode]);

  const send = useCallback(
    async (text: string): Promise<{ reply: string; performance: AssistantPerformance | null } | null> => {
      const content = text.trim();
      if (!content || pendingRef.current) return null;

      const userMsg: ChatbotMessage = { id: newId(), role: "user", content, createdAt: Date.now() };
      const next = [...messagesRef.current, userMsg];
      messagesRef.current = next;
      setMessages(next);
      persist(userMsg);
      setPending(true);
      pendingRef.current = true;
      setError(null);

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify({
            labId: labId ?? "",
            mode,
            messages: next
              .slice(-CONTEXT_TURNS)
              .map(({ role, content: c }) => ({ role, content: c })),
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          reply?: string;
          performance?: AssistantPerformance;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(json.error || `チャットに失敗しました（${res.status}）`);
        }
        const reply = (json.reply ?? "").trim();
        if (!reply) throw new Error("モデルが空の応答を返しました。");
        const assistantMsg: ChatbotMessage = {
          id: newId(),
          role: "assistant",
          content: reply,
          createdAt: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        persist(assistantMsg);
        return { reply, performance: json.performance ?? null };
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return null;
        const msg = e instanceof Error ? e.message : "チャットに失敗しました。";
        setError(msg);
        return null;
      } finally {
        if (abortRef.current === ac) abortRef.current = null;
        pendingRef.current = false;
        setPending(false);
      }
    },
    [labId, mode, persist],
  );

  return { messages, pending, error, labId, send, clear, setError };
}

/** Known female Japanese voices, most natural first (neural before legacy). */
const FEMALE_VOICE_RANK = [
  /nanami.*(online|natural)/i, // Edge: Microsoft Nanami Online (Natural)
  /aoi.*(online|natural)/i,
  /mayu.*(online|natural)/i,
  /shiori.*(online|natural)/i,
  /google\s*日本語/i, // Chrome: female
  /kyoko/i, // macOS / iOS
  /o-ren/i,
  /nanami/i,
  /haruka/i, // Windows legacy
  /ayumi/i,
  /sayaka/i,
  /female|woman|女性/i,
];

const MALE_VOICE_HINT = /keita|ichiro|otoya|hattori|naoki|daichi|male|男性/i;

/** Prefer a natural female standard-Japanese voice when the OS exposes one. */
function pickJapaneseVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  const ja = voices.filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith("ja"));
  if (ja.length === 0) return null;
  // "female" contains "male"; strip it before testing for a male voice.
  const isMale = (v: SpeechSynthesisVoice) => MALE_VOICE_HINT.test(v.name.replace(/female/gi, ""));
  for (const pattern of FEMALE_VOICE_RANK) {
    const hit = ja.find((v) => pattern.test(v.name) && !isMale(v));
    if (hit) return hit;
  }
  return ja.find((v) => !isMale(v)) ?? ja[0] ?? null;
}

/** Utterance lifecycle hooks, used by the avatar to follow browser speech. */
export interface SpeechHandlers {
  onStart?: () => void;
  /** `charIndex` into the trimmed text; not every voice fires these. */
  onBoundary?: (charIndex: number) => void;
  onEnd?: () => void;
}

function utterJapanese(text: string, handlers: SpeechHandlers): void {
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    const voice = pickJapaneseVoice();
    if (voice) u.voice = voice;
    // Slightly brighter than the OS default reads as a young speaker without
    // sounding synthetic; neural "Online" voices already have that timbre.
    u.pitch = voice && /online|natural/i.test(voice.name) ? 1 : 1.1;
    u.rate = 1;
    u.onstart = () => handlers.onStart?.();
    u.onboundary = (e) => handlers.onBoundary?.(e.charIndex);
    u.onend = () => handlers.onEnd?.();
    u.onerror = () => handlers.onEnd?.();
    window.speechSynthesis.speak(u);
  } catch {
    /* autoplay / missing voice — ignore */
    handlers.onEnd?.();
  }
}

/**
 * Best-effort Japanese speech synthesis for assistant replies.
 * Waits briefly for `voiceschanged` when the voice list is still empty
 * (common on first speak in Chromium).
 */
export function speakJapanese(text: string, handlers: SpeechHandlers = {}): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const content = text.trim();
  if (!content) return;

  if (window.speechSynthesis.getVoices().length > 0) {
    utterJapanese(content, handlers);
    return;
  }

  let spoken = false;
  const runOnce = () => {
    if (spoken) return;
    spoken = true;
    window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
    utterJapanese(content, handlers);
  };
  const onVoices = () => runOnce();
  window.speechSynthesis.addEventListener("voiceschanged", onVoices);
  window.setTimeout(runOnce, 300);
}

export function stopSpeaking(): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* noop */
  }
}
