import { NextResponse } from "next/server";
import { AiError, aiConfig, isAiEnabled, respondStructured } from "@/lib/ai/openai";
import { requireChatbotAccess } from "@/lib/ai/chatbotAccess";
import { assistantSystemPrompt, type AssistantMode } from "@/lib/ai/assistantKnowledge";
import { knowledgeForConversation } from "@/lib/ai/assistantKnowledgeStore";
import {
  PERFORMANCE_SCHEMA,
  normalizePerformance,
  performanceText,
} from "@/lib/avatar/protocol";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_MESSAGES = 24;
const MAX_CONTENT_CHARS = 4_000;

type IncomingMessage = { role?: unknown; content?: unknown };

/**
 * Lab assistant chat for the floating voice / video chatbot panels.
 *
 * Pipeline: retrieve LABNOTE knowledge for the latest question (RAG) → the
 * model answers as `segments`, each sentence tagged with an emotion, a
 * gesture from the avatar library and an intensity → the client speaks the
 * text (TTS), plans the cues against the real audio and drives the avatar.
 *
 * Open to guests: see `requireChatbotAccess` for why and how it is limited.
 * The conversation history itself lives in the browser (IndexedDB); the
 * client sends the recent turns with every request.
 */
export async function POST(request: Request) {
  if (!isAiEnabled()) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY が設定されていないため、チャットは利用できません。" },
      { status: 503 },
    );
  }

  try {
    const body = await request.json();
    const gate = await requireChatbotAccess(request, "chat", String(body?.labId ?? ""));
    if (!gate.ok) {
      return NextResponse.json(
        { error: gate.error },
        { status: gate.status, headers: { "Retry-After": String(gate.retryAfterSec) } },
      );
    }

    const mode: AssistantMode = body?.mode === "video" ? "video" : "voice";

    const rawMessages = Array.isArray(body?.messages) ? (body.messages as IncomingMessage[]) : [];
    if (rawMessages.length === 0) {
      return NextResponse.json({ error: "メッセージが空です。" }, { status: 400 });
    }

    const messages: { role: "user" | "assistant"; content: string }[] = [];
    for (const m of rawMessages.slice(-MAX_MESSAGES)) {
      const role = m.role === "assistant" ? "assistant" : m.role === "user" ? "user" : null;
      const content = String(m.content ?? "").trim().slice(0, MAX_CONTENT_CHARS);
      if (!role || !content) continue;
      messages.push({ role, content });
    }

    if (messages.length === 0) {
      return NextResponse.json({ error: "有効なメッセージがありません。" }, { status: 400 });
    }
    if (messages[messages.length - 1].role !== "user") {
      return NextResponse.json({ error: "最後のメッセージはユーザー発話である必要があります。" }, { status: 400 });
    }

    const started = Date.now();
    const knowledge = await knowledgeForConversation(
      messages.filter((m) => m.role === "user").map((m) => m.content),
    );
    const result = await respondStructured<unknown>({
      model: aiConfig().cheap,
      system: assistantSystemPrompt(mode, gate.viewer, knowledge),
      messages,
      schemaName: "assistant_performance",
      schema: PERFORMANCE_SCHEMA as unknown as Record<string, unknown>,
    });
    const performance = normalizePerformance(result.data);
    const reply = performanceText(performance);
    if (!reply) {
      return NextResponse.json({ error: "モデルが空の応答を返しました。" }, { status: 502 });
    }

    return NextResponse.json({
      reply,
      performance,
      knowledge: knowledge.map((d) => d.id),
      model: result.model,
      usage: result.usage,
      elapsedMs: Date.now() - started,
    });
  } catch (e) {
    if (e instanceof AiError) {
      return NextResponse.json({ error: e.message, retryable: e.retryable }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "チャットに失敗しました。" },
      { status: 500 },
    );
  }
}
