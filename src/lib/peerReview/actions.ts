"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { getSessionContext, logAudit } from "@/lib/auth/guards";
import type { Json, PeerReviewRow } from "@/lib/supabase/types";
import type { PeerReviewReport } from "@/lib/ai/peerReview";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface SavePeerReviewInput {
  labId: string;
  experimentId: string;
  title: string;
  sourceFilename: string | null;
  extractedText: string;
  report: PeerReviewReport;
  /** Set when this is a re-review of a revised draft. */
  previousReviewId?: string | null;
}

/**
 * Persists a completed review.
 *
 * The AI call itself already happened by the time this runs (in the route
 * handler, which holds the API key) - this only records the result the
 * client already has, the same division `saveNotebookEntry` and
 * `saveAnalysis` use for their own AI- or computation-derived results.
 */
export async function savePeerReview(
  input: SavePeerReviewInput,
): Promise<ActionResult<PeerReviewRow>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };

  const title = input.title.trim();
  if (!title) return { ok: false, error: "タイトルを入力してください。" };
  if (!input.extractedText.trim()) return { ok: false, error: "本文がありません。" };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("peer_reviews")
    .insert({
      lab_id: input.labId,
      experiment_id: input.experimentId,
      document_kind: "paper",
      title,
      source_filename: input.sourceFilename,
      extracted_text: input.extractedText,
      reviewer_results: input.report.reviewers as unknown as Json,
      category_scores: input.report.categoryScores as unknown as Json,
      overall_score: input.report.overallScore,
      previous_review_id: input.previousReviewId ?? null,
      created_by: ctx.user.id,
    })
    .select("*")
    .single();

  if (error) return { ok: false, error: error.message };

  await logAudit({
    labId: input.labId, userId: ctx.user.id, action: "peer_review.saved",
    entity: "peer_review", entityId: data.id,
    detail: {
      experiment_id: input.experimentId, title,
      overall_score: input.report.overallScore,
      is_re_review: Boolean(input.previousReviewId),
    },
  });

  return { ok: true, data };
}

export interface PeerReviewSummary {
  id: string;
  title: string;
  source_filename: string | null;
  overall_score: number;
  previous_review_id: string | null;
  created_at: string;
}

/** Every review recorded against one experiment, newest first. */
export async function listPeerReviews(
  experimentId: string,
): Promise<ActionResult<PeerReviewSummary[]>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("peer_reviews")
    .select("id, title, source_filename, overall_score, previous_review_id, created_at")
    .eq("experiment_id", experimentId)
    .order("created_at", { ascending: false });

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data ?? [] };
}

/** One review's full record, for the detail view and for re-review context. */
export async function getPeerReview(id: string): Promise<ActionResult<PeerReviewRow>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("peer_reviews")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "レビューが見つかりません。" };
  return { ok: true, data };
}
