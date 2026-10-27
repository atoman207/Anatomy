import "server-only";

import { AiError } from "./openai";

/**
 * The assistant's face and voice: a cloned persona from Anam (lab.anam.ai).
 *
 * Anam renders a photorealistic, lip-synced video stream of the persona
 * speaking whatever text it is given. It does NOT decide what she says:
 * sessions are created with `llmId: "CUSTOMER_CLIENT_V1"`, which switches
 * Anam's built-in LLM off, so every word comes from our OpenAI pipeline
 * (realtime model + knowledge snippets) and is streamed to the persona.
 *
 * The persona is configured in Anam Lab; its avatar, voice and expressiveness
 * are read from the API at runtime, so editing the persona there needs no
 * deploy. Its Lab-side LLM, English greeting and language are deliberately
 * not used - the session overrides them for this Japanese assistant.
 *
 * The API key never leaves the server: the browser only ever receives a
 * short-lived session token.
 */

const API_BASE = "https://api.anam.ai/v1";
/** Tells Anam not to run its own language model; the client supplies the words. */
const CLIENT_LLM_ID = "CUSTOMER_CLIENT_V1";
/** Signed media URLs from the API live ~60 min; refresh well before that. */
const PERSONA_CACHE_MS = 30 * 60_000;
/** Hard stop for one avatar session (Anam bills per streamed minute). */
const MAX_SESSION_SECONDS = 15 * 60;

export interface AnamPersona {
  name: string;
  avatarId: string;
  avatarModel: string | null;
  voiceId: string;
  directorNotes: Record<string, unknown> | null;
  /** Looping idle clip of the persona (signed URL, ~60 min). */
  idleVideoUrl: string | null;
  portraitImageUrl: string | null;
}

export function isAnamEnabled(): boolean {
  return Boolean(process.env.ANAM_API_KEY && process.env.ANAM_PERSONA_ID);
}

function apiKey(): string {
  const key = process.env.ANAM_API_KEY;
  if (!key) throw new AiError("ANAM_API_KEY が設定されていません。", 503);
  return key;
}

async function anamFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15_000);
  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: ac.signal,
      cache: "no-store",
    });
  } catch (e) {
    throw new AiError(
      e instanceof Error && e.name === "AbortError"
        ? "アバターサービスへの接続がタイムアウトしました。"
        : "アバターサービスに接続できませんでした。",
      503,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function failure(res: Response, what: string): Promise<AiError> {
  let detail = "";
  try {
    const body = (await res.json()) as { message?: string; error?: string };
    detail = body.message ?? body.error ?? "";
  } catch {
    /* non-JSON error body */
  }
  // 401/403 means a wrong or revoked key - an operator problem, not the user's.
  if (res.status === 401 || res.status === 403) {
    return new AiError(`アバターサービスの認証に失敗しました（${what}）。`, 503);
  }
  if (res.status === 429) return new AiError("アバターサービスが混み合っています。少し待ってからお試しください。", 429);
  return new AiError(`アバターサービスでエラーが発生しました（${what}${detail ? `: ${detail}` : ""}）。`, res.status >= 500 ? 502 : res.status);
}

let personaCache: { at: number; persona: AnamPersona } | null = null;

type PersonaResponse = {
  name?: string;
  avatarModel?: string;
  avatar?: { id?: string; idleVideoUrl?: string; portraitImageUrl?: string };
  voice?: { id?: string };
  directorNotes?: Record<string, unknown> | null;
};

export async function getAnamPersona(): Promise<AnamPersona> {
  if (personaCache && Date.now() - personaCache.at < PERSONA_CACHE_MS) return personaCache.persona;

  const id = process.env.ANAM_PERSONA_ID;
  if (!id) throw new AiError("ANAM_PERSONA_ID が設定されていません。", 503);
  const res = await anamFetch(`/personas/${encodeURIComponent(id)}`);
  if (!res.ok) throw await failure(res, "persona");
  const body = (await res.json()) as PersonaResponse;
  if (!body.avatar?.id || !body.voice?.id) {
    throw new AiError("アバターの設定（アバターまたは声）が見つかりません。", 502);
  }

  const persona: AnamPersona = {
    name: body.name ?? "Assistant",
    avatarId: body.avatar.id,
    avatarModel: body.avatarModel ?? null,
    voiceId: body.voice.id,
    directorNotes: body.directorNotes ?? null,
    idleVideoUrl: body.avatar.idleVideoUrl ?? null,
    portraitImageUrl: body.avatar.portraitImageUrl ?? null,
  };
  personaCache = { at: Date.now(), persona };
  return persona;
}

/**
 * Short-lived token the browser uses to open the avatar's WebRTC stream.
 * Same face, voice and style as the Lab persona, with Anam's LLM switched off.
 */
export async function createAnamSessionToken(): Promise<string> {
  const persona = await getAnamPersona();
  const res = await anamFetch("/auth/session-token", {
    method: "POST",
    body: JSON.stringify({
      personaConfig: {
        name: persona.name,
        avatarId: persona.avatarId,
        ...(persona.avatarModel ? { avatarModel: persona.avatarModel } : {}),
        voiceId: persona.voiceId,
        llmId: CLIENT_LLM_ID,
        languageCode: "ja",
        maxSessionLengthSeconds: MAX_SESSION_SECONDS,
        ...(persona.directorNotes ? { directorNotes: persona.directorNotes } : {}),
      },
    }),
  });
  if (!res.ok) throw await failure(res, "session");
  const body = (await res.json()) as { sessionToken?: string };
  if (!body.sessionToken) throw new AiError("アバターのセッションを開始できませんでした。", 502);
  return body.sessionToken;
}
