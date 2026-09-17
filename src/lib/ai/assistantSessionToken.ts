import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Audience } from "./realtimeAssistant";

/**
 * A small signed token handed out with each live assistant session.
 *
 * `/api/ai/answer` runs once per question, right when the user stops
 * talking, so it must answer in milliseconds. Re-checking the Supabase
 * session on every question cost ~1s; instead the session route (which does
 * the full access check once) signs who the viewer is, and the answer route
 * only verifies the signature. Tokens expire with the session.
 */

const TTL_SECONDS = 60 * 60;

interface Payload {
  aud: Audience;
  exp: number;
}

function secret(): string {
  const s = process.env.ASSISTANT_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.OPENAI_API_KEY;
  if (!s) throw new Error("No secret available to sign assistant session tokens.");
  return s;
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

export function issueAssistantToken(audience: Audience): string {
  const body = Buffer.from(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS } satisfies Payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyAssistantToken(token: unknown): Audience | null {
  if (typeof token !== "string" || token.length > 512) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  try {
    const expected = Buffer.from(sign(body));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Payload;
    if (payload.exp < Date.now() / 1000) return null;
    return payload.aud === "member" ? "member" : "guest";
  } catch {
    return null;
  }
}
