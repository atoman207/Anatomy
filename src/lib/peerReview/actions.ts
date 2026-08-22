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
  labId?: string | null;
  experimentId?: string | null;
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
 * client already has. Lab and experiment are optional: personal credit-based
 * reviews are stored against the account alone.
 */
export async function savePeerReview(
  input: SavePeerReviewInput,
): Promise<ActionResult<PeerReviewRow>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };

  const title = input.title.trim();
  if (!title) return { ok: false, error: "タイトルを入力してください。" };
  if (!input.extractedText.trim()) return { ok: false, error: "本文がありません。" };

  const labId = input.labId?.trim() || null;
  const experimentId = input.experimentId?.trim() || null;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("peer_reviews")
    .insert({
      lab_id: labId,
      experiment_id: experimentId,
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
    labId, userId: ctx.user.id, action: "peer_review.saved",
    entity: "peer_review", entityId: data.id,
    detail: {
      experiment_id: experimentId, title,
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

export interface RecentPeerReviewSummary extends PeerReviewSummary {
  experiment_id: string | null;
  experiment_name: string | null;
  lab_name: string | null;
}

/**
 * Most recent reviews the caller can see: personal ones they created, plus
 * any still attached to a laboratory they belong to. RLS already enforces
 * that boundary; this only orders and shapes the rows for the dashboard.
 */
export async function listRecentPeerReviews(
  limit = 10,
): Promise<ActionResult<RecentPeerReviewSummary[]>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("peer_reviews")
    .select(
      "id, title, source_filename, overall_score, previous_review_id, created_at, experiment_id, experiments(name), laboratories(name)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return { ok: false, error: error.message };

  const rows: RecentPeerReviewSummary[] = (data ?? []).map((r) => {
    const experiment = (Array.isArray(r.experiments) ? r.experiments[0] : r.experiments) as
      | { name: string }
      | null;
    const lab = (Array.isArray(r.laboratories) ? r.laboratories[0] : r.laboratories) as
      | { name: string }
      | null;
    return {
      id: r.id,
      title: r.title,
      source_filename: r.source_filename,
      overall_score: r.overall_score,
      previous_review_id: r.previous_review_id,
      created_at: r.created_at,
      experiment_id: r.experiment_id,
      experiment_name: experiment?.name ?? null,
      lab_name: lab?.name ?? null,
    };
  });
  return { ok: true, data: rows };
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
