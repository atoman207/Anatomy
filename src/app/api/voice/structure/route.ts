import { NextResponse } from "next/server";
import { AiError, isAiEnabled } from "@/lib/ai/openai";
import {
  structureVoiceNote, voiceNoteToMarkdown, missingFields,
} from "@/lib/ai/voiceNote";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_CHARS = 20_000;

/**
 * Turns a transcript into structured fields.
 *
 * Kept separate from transcription so the researcher can correct the
 * transcript first, and so re-structuring after an edit does not mean paying
 * to transcribe the audio again.
 */
export async function POST(request: Request) {
  if (!isAiEnabled()) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY が設定されていないため、構造化は利用できません。" },
      { status: 503 },
    );
  }

  try {
    const body = await request.json();
    const transcript = String(body?.transcript ?? "").trim();
    const referenceDate =
      typeof body?.referenceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.referenceDate)
        ? body.referenceDate
        : undefined;

    if (!transcript) {
      return NextResponse.json({ error: "書き起こしが空です。" }, { status: 400 });
    }
    if (transcript.length > MAX_CHARS) {
      return NextResponse.json(
        { error: `書き起こしが長すぎます（${transcript.length} 文字、上限 ${MAX_CHARS}）。` },
        { status: 413 },
      );
    }

    const started = Date.now();
    const result = await structureVoiceNote({ transcript, referenceDate });

    return NextResponse.json({
      note: result.data,
      markdown: voiceNoteToMarkdown(result.data, { transcript, includeTranscript: true }),
      missing: missingFields(result.data),
      model: result.model,
      usage: result.usage,
      elapsedMs: Date.now() - started,
    });
  } catch (e) {
    if (e instanceof AiError) {
      return NextResponse.json({ error: e.message, retryable: e.retryable }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "構造化に失敗しました。" },
      { status: 500 },
    );
  }
}
