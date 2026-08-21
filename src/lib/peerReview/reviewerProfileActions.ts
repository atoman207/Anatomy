"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getSessionContext, logAudit } from "@/lib/auth/guards";
import { defaultReviewerProfiles, type ReviewerProfile } from "@/lib/ai/reviewerProfiles";
import type { ReviewerRole } from "@/lib/ai/peerReviewReport";
import type { ReviewerProfileRole } from "@/lib/supabase/types";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

const ROLES: ReviewerRole[] = ["methods", "novelty", "structure"];

function isReviewerRole(v: unknown): v is ReviewerRole {
  return typeof v === "string" && (ROLES as string[]).includes(v);
}

/**
 * The three reviewer profiles, read with the caller's own session.
 *
 * Falls back to the built-in defaults for any role missing a row - before
 * migration 0004 has run, or if a row was ever deleted - rather than making
 * every caller handle a partial result. A reviewer without a customized
 * rubric is exactly what an empty `rubric_notes` already means, so the
 * fallback is not a degraded state, just the starting one.
 */
export async function getReviewerProfiles(): Promise<Record<ReviewerRole, ReviewerProfile>> {
  const defaults = defaultReviewerProfiles();
  try {
    const supabase = await createServerSupabase();
    const { data } = await supabase.from("reviewer_profiles").select("role, name, rubric_notes");
    if (!data) return defaults;

    const result = { ...defaults };
    for (const row of data) {
      if (!isReviewerRole(row.role)) continue;
      result[row.role] = { role: row.role, name: row.name, rubricNotes: row.rubric_notes };
    }
    return result;
  } catch {
    return defaults;
  }
}

/**
 * Updates one reviewer's name and rubric notes.
 *
 * Platform-admin only: these three personas are shared by every laboratory
 * on the deployment, the same reasoning the model ids in `.env.local` are a
 * deployment-wide choice rather than something each lab tunes for itself.
 */
export async function updateReviewerProfile(
  role: string,
  name: string,
  rubricNotes: string,
): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  if (!ctx.isPlatformAdmin) return { ok: false, error: "システム管理者のみ利用できます。" };
  if (!isReviewerRole(role)) return { ok: false, error: "査読者の指定が不正です。" };

  const trimmedName = name.trim();
  if (!trimmedName) return { ok: false, error: "名前を入力してください。" };

  const admin = createAdminSupabase();
  const { error } = await admin
    .from("reviewer_profiles")
    .upsert(
      {
        role: role as ReviewerProfileRole,
        name: trimmedName,
        rubric_notes: rubricNotes,
        updated_by: ctx.user.id,
      },
      { onConflict: "role" },
    );
  if (error) return { ok: false, error: error.message };

  await logAudit({
    labId: null, userId: ctx.user.id, action: "peer_review.reviewer_profile_updated",
    entity: "reviewer_profile", entityId: role, detail: { name: trimmedName },
  });

  revalidatePath("/admin/peer-review");
  revalidatePath("/peer-review");
  return { ok: true };
}
