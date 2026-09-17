import "server-only";

import { getSessionContext } from "@/lib/auth/guards";
import { getLabEntitlement } from "@/lib/billing/subscription";
import { SlidingWindowLimiter, clientAddress } from "./chatbotRateLimit";

/**
 * The gate in front of the assistant chatbot (`/api/ai/chat`, `/api/ai/speech`).
 *
 * Unlike the other AI routes this one is open to everyone, guests included:
 * the assistant is the product's front door and answers "what is LABNOTE"
 * before anyone has an account. It never touches lab data, so the only thing
 * to protect is the API bill - callers without a paid AI plan are rate
 * limited instead of refused.
 */

export interface ChatbotViewer {
  signedIn: boolean;
  /** True when a lab the caller belongs to has the full AI suite. */
  aiPlan: boolean;
}

export type ChatbotAccess =
  | { ok: true; viewer: ChatbotViewer }
  | { ok: false; status: number; error: string; retryAfterSec: number };

const MINUTE = 60_000;

const limiters = {
  chat: new SlidingWindowLimiter([
    { limit: 20, windowMs: 10 * MINUTE },
    { limit: 120, windowMs: 24 * 60 * MINUTE },
  ]),
  speech: new SlidingWindowLimiter([
    { limit: 20, windowMs: 10 * MINUTE },
    { limit: 120, windowMs: 24 * 60 * MINUTE },
  ]),
  // One call per question; hits are free, so this only guards against abuse.
  answer: new SlidingWindowLimiter([
    { limit: 60, windowMs: 10 * MINUTE },
    { limit: 500, windowMs: 24 * 60 * MINUTE },
  ]),
  // One realtime session covers a whole conversation, so far fewer are needed.
  realtime: new SlidingWindowLimiter([
    { limit: 6, windowMs: 10 * MINUTE },
    { limit: 30, windowMs: 24 * 60 * MINUTE },
  ]),
};

export async function requireChatbotAccess(
  request: Request,
  kind: keyof typeof limiters,
  labId: string | null | undefined,
): Promise<ChatbotAccess> {
  let ctx: Awaited<ReturnType<typeof getSessionContext>> = null;
  try {
    ctx = await getSessionContext();
  } catch {
    // Auth outage or Supabase not configured: treat as a guest.
  }

  let aiPlan = false;
  if (ctx) {
    const requested = (labId ?? "").trim();
    const candidates = requested && ctx.memberships.some((m) => m.labId === requested)
      ? [requested]
      : ctx.memberships.map((m) => m.labId);
    for (const id of candidates) {
      if ((await getLabEntitlement(id)).aiEnabled) {
        aiPlan = true;
        break;
      }
    }
  }

  const viewer: ChatbotViewer = { signedIn: Boolean(ctx), aiPlan };
  if (aiPlan) return { ok: true, viewer };

  const key = ctx ? `user:${ctx.user.id}` : `ip:${clientAddress(request.headers)}`;
  const decision = limiters[kind].take(key);
  if (!decision.ok) {
    const minutes = Math.max(1, Math.ceil(decision.retryAfterSec / 60));
    return {
      ok: false,
      status: 429,
      retryAfterSec: decision.retryAfterSec,
      error:
        `ご利用が集中しています。約${minutes}分後にもう一度お試しください。` +
        (ctx ? "" : "ログインして個人研究者プラン以上をご利用いただくと、回数の制限なくお使いいただけます。"),
    };
  }
  return { ok: true, viewer };
}

/**
 * Rate limit only, keyed by client address - for calls whose caller was
 * already authorized by a signed session token (no Supabase round trip).
 */
export function limitByAddress(
  request: Request,
  kind: keyof typeof limiters,
): { ok: true } | { ok: false; status: number; error: string; retryAfterSec: number } {
  const decision = limiters[kind].take(`ip:${clientAddress(request.headers)}`);
  if (decision.ok) return { ok: true };
  const minutes = Math.max(1, Math.ceil(decision.retryAfterSec / 60));
  return {
    ok: false,
    status: 429,
    retryAfterSec: decision.retryAfterSec,
    error: `ご利用が集中しています。約${minutes}分後にもう一度お試しください。`,
  };
}
