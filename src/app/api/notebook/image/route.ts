import { NextResponse } from "next/server";
import { AiError, isAiEnabled, generateImage } from "@/lib/ai/openai";
import { requireAiAccess } from "@/lib/billing/subscription";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_PROMPT_CHARS = 2_000;

/**
 * Generates one image from a prompt, for the notebook step's chart/image
 * insert panel. Sits next to /api/voice/structure as the second AI entry
 * point that panel uses - same billing gate, same error shape.
 */
export async function POST(request: Request) {
  if (!isAiEnabled()) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY が設定されていないため、画像生成は利用できません。" },
      { status: 503 },
    );
  }

  try {
    const body = await request.json();

    const gate = await requireAiAccess(String(body?.labId ?? ""));
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    const prompt = String(body?.prompt ?? "").trim();
    if (!prompt) {
      return NextResponse.json({ error: "プロンプトを入力してください。" }, { status: 400 });
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      return NextResponse.json(
        { error: `プロンプトが長すぎます（${prompt.length} 文字、上限 ${MAX_PROMPT_CHARS}）。` },
        { status: 413 },
      );
    }

    const started = Date.now();
    const image = await generateImage(prompt);

    return NextResponse.json({
      dataUri: `data:image/png;base64,${image.base64}`,
      model: image.model,
      elapsedMs: Date.now() - started,
    });
  } catch (e) {
    if (e instanceof AiError) {
      return NextResponse.json({ error: e.message, retryable: e.retryable }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "画像の生成に失敗しました。" },
      { status: 500 },
    );
  }
}
