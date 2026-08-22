import { NextResponse } from "next/server";
import { AiError, isAiEnabled } from "@/lib/ai/openai";
import { runFullReview, type PeerReviewReport } from "@/lib/ai/peerReview";
import type { ReviewerRole } from "@/lib/ai/peerReviewReport";
import { extractPdfText, PdfExtractionError } from "@/lib/peerReview/pdf";
import { getReviewerProfiles } from "@/lib/peerReview/reviewerProfileActions";
import { consumePeerReviewCredit } from "@/lib/peerReview/credits";

export const runtime = "nodejs";
// Three sequential model calls against a long manuscript; give it the same
// ceiling as audio transcription rather than the ~2 minute default the
// single-call AI routes use.
export const maxDuration = 300;

const MAX_PDF_BYTES = 25 * 1024 * 1024;

export interface AnalyzeResponse {
  report: PeerReviewReport;
  extractedText: string;
  pageCount: number | null;
  models: string[];
  truncated: boolean;
}

/**
 * Runs the three-reviewer AI peer review against an uploaded PDF.
 *
 * Text extraction and the AI calls happen in the same request: nothing about
 * the PDF is persisted anywhere in this route, so there is no half-finished
 * upload to clean up if the AI call fails partway through - a failure here
 * just means the researcher tries again, exactly like a transcription retry.
 */
export async function POST(request: Request) {
  if (!isAiEnabled()) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY が設定されていないため、AI査読は利用できません。" },
      { status: 503 },
    );
  }

  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "PDFファイルがありません。" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "ファイルが空です。" }, { status: 400 });
    }
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json(
        {
          error:
            `ファイルが ${(file.size / 1024 ** 2).toFixed(1)} MB です。上限は ` +
            `${MAX_PDF_BYTES / 1024 ** 2} MB です。`,
        },
        { status: 413 },
      );
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "PDFファイルを選択してください。" }, { status: 415 });
    }

    let extracted;
    try {
      extracted = await extractPdfText(await file.arrayBuffer());
    } catch (e) {
      if (e instanceof PdfExtractionError) {
        return NextResponse.json({ error: e.message }, { status: 422 });
      }
      throw e;
    }

    // Spent only now, immediately before the three model calls: a bad or
    // unreadable PDF is rejected above without costing the caller a credit,
    // but from here on the credit is gone even if the AI call itself later
    // fails - the same "authoritative, not cosmetic" gate `requireAiAccess`
    // used to be for the AI routes still gated by a lab's plan.
    const gate = await consumePeerReviewCredit();
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    const profiles = await getReviewerProfiles();
    const rubricNotes: Partial<Record<ReviewerRole, string>> = {
      methods: profiles.methods.rubricNotes,
      novelty: profiles.novelty.rubricNotes,
      structure: profiles.structure.rubricNotes,
    };

    const started = Date.now();
    const { report, models, truncated } = await runFullReview({ text: extracted.text, rubricNotes });

    const response: AnalyzeResponse = {
      report,
      extractedText: extracted.text,
      pageCount: extracted.pageCount,
      models,
      truncated,
    };

    return NextResponse.json({ ...response, elapsedMs: Date.now() - started });
  } catch (e) {
    if (e instanceof AiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "査読に失敗しました。" },
      { status: 500 },
    );
  }
}
