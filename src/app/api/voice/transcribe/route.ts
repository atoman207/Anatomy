import { NextResponse } from "next/server";
import { transcribeAudio, AiError, isAiEnabled, aiConfig } from "@/lib/ai/openai";
import { requireAiAccess } from "@/lib/billing/subscription";

export const runtime = "nodejs";
export const maxDuration = 300;

/** OpenAI caps uploads at 25 MB; reject earlier with a clearer message. */
const MAX_BYTES = 25 * 1024 * 1024;

const ACCEPTED = [
  "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/mp3",
  "audio/wav", "audio/x-wav", "audio/m4a", "audio/x-m4a", "audio/flac",
  "video/webm", // MediaRecorder labels Opus-in-WebM this way in some browsers
];

/**
 * Transcribes a recorded memo.
 *
 * Audio is streamed straight to OpenAI and never written to disk here; only
 * the resulting text comes back.
 */
export async function POST(request: Request) {
  if (!isAiEnabled()) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY が設定されていないため、文字起こしは利用できません。" },
      { status: 503 },
    );
  }

  try {
    const form = await request.formData();
    const file = form.get("audio");
    const language = String(form.get("language") ?? "ja") || "ja";
    const prompt = form.get("prompt");

    // Transcription spends money per call on the deployment key, so the
    // laboratory's plan is checked before any audio is forwarded.
    const gate = await requireAiAccess(String(form.get("labId") ?? ""));
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "音声ファイルがありません。" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json(
        { error: "録音が空です。マイクの権限を確認してください。" },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          error:
            `録音が ${(file.size / 1024 ** 2).toFixed(1)} MB です。上限は 25 MB（およそ20分）です。` +
            "分割して録音してください。",
        },
        { status: 413 },
      );
    }

    const type = (file.type || "").split(";")[0].toLowerCase();
    if (type && !ACCEPTED.includes(type)) {
      return NextResponse.json(
        { error: `対応していない音声形式です: ${file.type}` },
        { status: 415 },
      );
    }

    const started = Date.now();
    const result = await transcribeAudio(file, file.name || "memo.webm", {
      language,
      prompt: typeof prompt === "string" && prompt.trim() ? prompt : undefined,
    });

    if (!result.text) {
      return NextResponse.json(
        {
          error:
            "音声から文字を検出できませんでした。マイクに近づくか、静かな場所で録り直してください。",
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      text: result.text,
      model: result.model,
      language: result.language,
      audioSeconds: result.durationSeconds,
      elapsedMs: Date.now() - started,
      bytes: file.size,
    });
  } catch (e) {
    if (e instanceof AiError) {
      return NextResponse.json({ error: e.message, retryable: e.retryable }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "文字起こしに失敗しました。" },
      { status: 500 },
    );
  }
}

/** Reports which transcription model is configured, for the UI to display. */
export async function GET() {
  const cfg = aiConfig();
  return NextResponse.json({
    enabled: cfg.enabled,
    model: cfg.transcribe,
    maxBytes: MAX_BYTES,
  });
}
