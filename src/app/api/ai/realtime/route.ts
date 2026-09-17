import { NextResponse } from "next/server";
import { AiError, createRealtimeClientSecret, isAiEnabled } from "@/lib/ai/openai";
import { requireChatbotAccess } from "@/lib/ai/chatbotAccess";
import { realtimeSessionInstructions } from "@/lib/ai/realtimeAssistant";
import { issueAssistantToken } from "@/lib/ai/assistantSessionToken";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Starts a live voice conversation with the assistant.
 *
 * Returns a short-lived client secret; the browser then connects to OpenAI's
 * realtime API over WebRTC itself, so speech goes straight to the model and
 * the spoken reply starts within about a second of the user finishing.
 * Gated and rate limited like `/api/ai/chat` (open to guests).
 */
export async function POST(request: Request) {
  if (!isAiEnabled()) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY が設定されていないため、音声会話は利用できません。" },
      { status: 503 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const gate = await requireChatbotAccess(request, "realtime", String(body?.labId ?? ""));
    if (!gate.ok) {
      return NextResponse.json(
        { error: gate.error },
        { status: gate.status, headers: { "Retry-After": String(gate.retryAfterSec) } },
      );
    }

    const audience = gate.viewer.signedIn ? "member" : "guest";
    const secret = await createRealtimeClientSecret({
      // Persona only; knowledge is attached per question (fewer tokens per turn).
      instructions: realtimeSessionInstructions(audience),
    });
    return NextResponse.json(
      {
        clientSecret: secret.value,
        expiresAt: secret.expiresAt,
        model: secret.model,
        // Lets /api/ai/answer skip re-checking the session on every question.
        answerToken: issueAssistantToken(audience),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof AiError) {
      return NextResponse.json({ error: e.message, retryable: e.retryable }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "音声会話を開始できませんでした。" },
      { status: 500 },
    );
  }
}
