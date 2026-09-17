import { NextResponse } from "next/server";
import { AiError, isAiEnabled, synthesizeSpeech } from "@/lib/ai/openai";
import { requireChatbotAccess } from "@/lib/ai/chatbotAccess";
import { ASSISTANT_VOICE_INSTRUCTIONS } from "@/lib/ai/assistantKnowledge";

export const runtime = "nodejs";
export const maxDuration = 60;

/** The speech endpoint rejects inputs longer than this. */
const MAX_INPUT_CHARS = 4_000;

/**
 * Spoken audio for the assistant avatar's replies.
 *
 * Gated like `/api/ai/chat`: open to guests, rate limited without a paid AI
 * plan. On any failure the client falls back to browser speech.
 */
export async function POST(request: Request) {
  if (!isAiEnabled()) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY が設定されていないため、音声合成は利用できません。" },
      { status: 503 },
    );
  }

  try {
    const body = await request.json();
    const gate = await requireChatbotAccess(request, "speech", String(body?.labId ?? ""));
    if (!gate.ok) {
      return NextResponse.json(
        { error: gate.error },
        { status: gate.status, headers: { "Retry-After": String(gate.retryAfterSec) } },
      );
    }

    const text = String(body?.text ?? "").trim().slice(0, MAX_INPUT_CHARS);
    if (!text) {
      return NextResponse.json({ error: "読み上げるテキストが空です。" }, { status: 400 });
    }

    // Unreal (Pixel Streaming) wants PCM WAV; the browser plays MP3.
    const format = body?.format === "wav" ? "wav" : "mp3";
    const result = await synthesizeSpeech(text, { instructions: ASSISTANT_VOICE_INSTRUCTIONS, format });
    return new Response(result.audio, {
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AiError) {
      return NextResponse.json({ error: e.message, retryable: e.retryable }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "音声合成に失敗しました。" },
      { status: 500 },
    );
  }
}
