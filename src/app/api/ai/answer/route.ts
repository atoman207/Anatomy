import { NextResponse, after } from "next/server";
import { limitByAddress, requireChatbotAccess } from "@/lib/ai/chatbotAccess";
import { verifyAssistantToken } from "@/lib/ai/assistantSessionToken";
import { knowledgeForConversation } from "@/lib/ai/assistantKnowledgeStore";
import { responseInstructions, type Audience } from "@/lib/ai/realtimeAssistant";
import { skipReason } from "@/lib/ai/answerCache/matcher";
import { lookupAnswer, recordHit, recordMissAndMaybeGenerate } from "@/lib/ai/answerCache/store";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Decides how the assistant answers one question, spending as few tokens as
 * possible:
 *
 * - `hit`: an equivalent question was answered before -> the stored text and
 *   voice are replayed; no model is called at all.
 * - miss: returns per-response instructions carrying only the knowledge
 *   snippets relevant to this question, for the realtime model to answer live.
 *   After responding, the question is counted; once it recurs, a canonical
 *   answer is generated and cached for everyone.
 *
 * Questions that depend on the conversation, the asker or the date skip the
 * shared cache entirely (see `skipReason`).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  // Fast path: a live session already proved who this is (signed token), so
  // only the rate limit applies. Otherwise do the full access check.
  let audience: Audience | null = verifyAssistantToken(body?.token);
  if (audience) {
    const limited = limitByAddress(request, "answer");
    if (!limited.ok) {
      return NextResponse.json(
        { error: limited.error },
        { status: limited.status, headers: { "Retry-After": String(limited.retryAfterSec) } },
      );
    }
  } else {
    const gate = await requireChatbotAccess(request, "answer", String(body?.labId ?? ""));
    if (!gate.ok) {
      return NextResponse.json(
        { error: gate.error },
        { status: gate.status, headers: { "Retry-After": String(gate.retryAfterSec) } },
      );
    }
    audience = gate.viewer.signedIn ? "member" : "guest";
  }

  const question = String(body?.question ?? "").trim().slice(0, 300);
  if (!question) return NextResponse.json({ error: "質問が空です。" }, { status: 400 });
  const previous = String(body?.previousQuestion ?? "").trim().slice(0, 300);

  const skip = skipReason(question);
  // Knowledge retrieval and the cache lookup are independent: run them together.
  const [docs, cached] = await Promise.all([
    knowledgeForConversation(previous ? [previous, question] : [question], 3),
    skip ? Promise.resolve({ hit: false } as const) : lookupAnswer(question, audience),
  ]);
  const instructions = responseInstructions(audience, docs);
  const who = audience;

  if (!skip) {
    if (cached.hit) {
      after(() => recordHit(cached.id));
      return NextResponse.json(
        {
          hit: true,
          id: cached.id,
          answer: cached.answer,
          audioUrl: `/api/ai/answer/${cached.id}/audio`,
          // Fallback if the stored audio cannot be played.
          instructions,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    after(() => recordMissAndMaybeGenerate(question, who));
  }

  return NextResponse.json({ hit: false, skip, instructions }, { headers: { "Cache-Control": "no-store" } });
}
