import { NextResponse } from "next/server";
import { AiError, isAiEnabled } from "@/lib/ai/openai";
import { runFullReview } from "@/lib/ai/peerReview";
import {
  allMajorConcerns,
  type PeerReviewReport, type PublicationAssessment, type ReviewTier, type ReviewerRole,
} from "@/lib/ai/peerReviewReport";
import { assessPublicationFit } from "@/lib/ai/publicationAssessment";
import { checkJournalFormat, type JournalFormatCheckResult } from "@/lib/ai/journalFormatCheck";
import { REVIEWER_PERSONALITIES, type PersonalityId } from "@/lib/ai/reviewerPersonalities";
import { extractPdfText, PdfExtractionError } from "@/lib/peerReview/pdf";
import { extractDocxText, DocxExtractionError } from "@/lib/peerReview/docx";
import { fetchJournalPageText, JournalFetchError } from "@/lib/peerReview/journalFetch";
import { getReviewerProfiles } from "@/lib/peerReview/reviewerProfileActions";
import { consumePeerReviewCredit } from "@/lib/peerReview/credits";

export const runtime = "nodejs";
// Three sequential model calls against a long manuscript; give it the same
// ceiling as audio transcription rather than the ~2 minute default the
// single-call AI routes use.
export const maxDuration = 300;

const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Extensions accepted for the manuscript upload, and which extractor each one uses. */
const EXTRACTORS: Record<string, "pdf" | "docx"> = { ".pdf": "pdf", ".docx": "docx" };

export interface AnalyzeResponse {
  report: PeerReviewReport;
  extractedText: string;
  /** PDF only - a .docx upload has no page count. */
  pageCount: number | null;
  models: string[];
  truncated: boolean;
  /** Present only when a journal URL was supplied; `error` when the check itself could not run. */
  journalCheck?: { data: JournalFormatCheckResult; model: string; journalUrl: string } | { error: string };
  /** Best-effort IF-range / recommended-journals / acceptance-likelihood estimate; `error` when it could not run. */
  assessment?: { data: PublicationAssessment; model: string } | { error: string };
}

const VALID_TIERS: ReviewTier[] = ["top", "standard"];
const VALID_PERSONALITIES = new Set(REVIEWER_PERSONALITIES.map((p) => p.id));
const REVIEWER_ROLES: ReviewerRole[] = ["methods", "novelty", "structure"];

/** Parses the `personalities` form field (JSON, keyed by role), ignoring anything unrecognized rather than failing the whole request. */
function parsePersonalities(raw: string): Partial<Record<ReviewerRole, PersonalityId>> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Record<ReviewerRole, PersonalityId>> = {};
    for (const role of REVIEWER_ROLES) {
      const v = parsed[role];
      if (typeof v === "string" && VALID_PERSONALITIES.has(v as PersonalityId)) {
        out[role] = v as PersonalityId;
      }
    }
    return out;
  } catch {
    return {};
  }
}
/** Field-context excerpt for assessPublicationFit - enough to identify the topic, not the full manuscript. */
const ASSESSMENT_EXCERPT_CHARS = 6_000;
/** Most severe concerns, across all three reviewers, fed to the publication-fit estimate. */
const TOP_CONCERNS_COUNT = 6;

/**
 * Runs the three-reviewer AI peer review against an uploaded manuscript
 * (PDF or Word), and optionally checks it against a target journal's stated
 * format guidelines when a URL is supplied alongside the file.
 *
 * Text extraction and the AI calls happen in the same request: nothing about
 * the uploaded file is persisted anywhere in this route, so there is no
 * half-finished upload to clean up if the AI call fails partway through - a
 * failure here just means the researcher tries again, exactly like a
 * transcription retry.
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
    const journalUrl = String(form.get("journalUrl") ?? "").trim();
    const targetJournalName = String(form.get("targetJournalName") ?? "").trim();
    const tierRaw = String(form.get("tier") ?? "standard");
    const tier: ReviewTier = VALID_TIERS.includes(tierRaw as ReviewTier) ? (tierRaw as ReviewTier) : "standard";
    const personalities = parsePersonalities(String(form.get("personalities") ?? ""));

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "ファイルがありません。" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "ファイルが空です。" }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          error:
            `ファイルが ${(file.size / 1024 ** 2).toFixed(1)} MB です。上限は ` +
            `${MAX_FILE_BYTES / 1024 ** 2} MB です。`,
        },
        { status: 413 },
      );
    }
    const name = file.name.toLowerCase();
    const ext = Object.keys(EXTRACTORS).find((e) => name.endsWith(e));
    if (!ext) {
      return NextResponse.json(
        { error: "PDFまたはWord（.docx）ファイルを選択してください。" },
        { status: 415 },
      );
    }

    let extractedText: string;
    let pageCount: number | null = null;
    try {
      if (EXTRACTORS[ext] === "pdf") {
        const extracted = await extractPdfText(await file.arrayBuffer());
        extractedText = extracted.text;
        pageCount = extracted.pageCount;
      } else {
        const extracted = await extractDocxText(await file.arrayBuffer());
        extractedText = extracted.text;
      }
    } catch (e) {
      if (e instanceof PdfExtractionError || e instanceof DocxExtractionError) {
        return NextResponse.json({ error: e.message }, { status: 422 });
      }
      throw e;
    }

    // Spent only now, immediately before the three model calls: a bad or
    // unreadable file is rejected above without costing the caller a credit,
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
    const { report, models, truncated } = await runFullReview({
      text: extractedText, tier, rubricNotes, personalities,
    });

    // Best-effort, run after the three reviewers rather than instead of one
    // of them (see publicationAssessment.ts for why): a failure here should
    // not throw away an otherwise-successful review the researcher already
    // spent a credit on, so it becomes a reported `error`, not a thrown one.
    let assessment: AnalyzeResponse["assessment"];
    try {
      const topConcerns = allMajorConcerns(report)
        .sort((a, b) => b.severity - a.severity)
        .slice(0, TOP_CONCERNS_COUNT)
        .map((c) => `[${c.reviewer}] ${c.issue}（深刻度 ${c.severity}/10）`);
      const result = await assessPublicationFit({
        manuscriptExcerpt: extractedText.slice(0, ASSESSMENT_EXCERPT_CHARS),
        tier,
        overallScore: report.overallScore,
        topConcerns,
        targetJournalName,
      });
      assessment = result;
    } catch (e) {
      assessment = {
        error: e instanceof AiError ? e.message : "掲載可能性の評価に失敗しました。",
      };
    }

    // Best-effort and independent of the three reviewers: a journal page
    // that fails to fetch or has nothing usable on it should not throw away
    // an otherwise-successful review the researcher already spent a credit
    // on, so any failure here becomes a reported `error`, not a thrown one.
    let journalCheck: AnalyzeResponse["journalCheck"];
    if (journalUrl) {
      try {
        const page = await fetchJournalPageText(journalUrl);
        const result = await checkJournalFormat({
          manuscriptText: extractedText,
          journalUrl: page.url,
          journalPageText: page.text,
        });
        journalCheck = { ...result, journalUrl: page.url };
      } catch (e) {
        journalCheck = {
          error: e instanceof JournalFetchError || e instanceof AiError
            ? e.message
            : "ジャーナルとの形式チェックに失敗しました。",
        };
      }
    }

    const response: AnalyzeResponse = {
      report,
      extractedText,
      pageCount,
      models,
      truncated,
      journalCheck,
      assessment,
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
