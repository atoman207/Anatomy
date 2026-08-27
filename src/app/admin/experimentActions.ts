"use server";

/**
 * Administrator CRUD over experiments across every laboratory the caller
 * manages (every laboratory, for a platform administrator). Every mutation
 * re-derives the caller's authority with `assertCanManageLab` rather than
 * trusting the lab id posted from the browser - the same rule the rest of
 * the admin console follows.
 */

import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/server";
import { assertCanManageLab, getSessionContext, logAudit } from "@/lib/auth/guards";
import type { Experiment, ExperimentStatus } from "@/lib/supabase/types";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

const STATUSES: ExperimentStatus[] = ["planned", "in_progress", "complete", "archived"];

export interface AdminExperimentInput {
  experimentId?: string;
  labId: string;
  name: string;
  experimentDate: string;
  operator: string;
  purpose: string;
  status: string;
  tags: string;
}

function parseTags(raw: string): string[] {
  return raw.split(",").map((t) => t.trim()).filter(Boolean);
}

export async function adminSaveExperiment(
  input: AdminExperimentInput,
): Promise<ActionResult<Experiment>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "実験名を入力してください。" };
  if (!input.labId) return { ok: false, error: "研究室を選択してください。" };
  if (!input.experimentDate) return { ok: false, error: "実験日を入力してください。" };
  const status = STATUSES.includes(input.status as ExperimentStatus)
    ? (input.status as ExperimentStatus)
    : "planned";

  try {
    await assertCanManageLab(ctx, input.labId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "権限がありません。" };
  }

  const admin = createAdminSupabase();
  const payload = {
    lab_id: input.labId,
    name,
    experiment_date: input.experimentDate,
    operator: input.operator.trim() || null,
    purpose: input.purpose.trim() || null,
    status,
    tags: parseTags(input.tags),
  };

  if (input.experimentId) {
    const { data: existing } = await admin
      .from("experiments")
      .select("lab_id")
      .eq("id", input.experimentId)
      .maybeSingle();
    if (!existing) return { ok: false, error: "実験が見つかりません。" };
    // Moving an experiment between labs requires authority over both.
    if (existing.lab_id !== input.labId) {
      try {
        await assertCanManageLab(ctx, existing.lab_id);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "権限がありません。" };
      }
    }

    const { data, error } = await admin
      .from("experiments")
      .update(payload)
      .eq("id", input.experimentId)
      .select("*")
      .single();
    if (error) return { ok: false, error: error.message };

    await logAudit({
      labId: input.labId, userId: ctx.user.id, action: "experiment.admin_updated",
      entity: "experiment", entityId: data.id, detail: { name },
    });
    revalidatePath("/admin/experiments");
    return { ok: true, data };
  }

  const { data, error } = await admin
    .from("experiments")
    .insert({ ...payload, created_by: ctx.user.id })
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };

  await logAudit({
    labId: input.labId, userId: ctx.user.id, action: "experiment.admin_created",
    entity: "experiment", entityId: data.id, detail: { name },
  });
  revalidatePath("/admin/experiments");
  return { ok: true, data };
}

export async function adminDeleteExperiment(experimentId: string): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  if (!experimentId) return { ok: false, error: "実験が選択されていません。" };

  const admin = createAdminSupabase();
  const { data: existing } = await admin
    .from("experiments")
    .select("lab_id, name")
    .eq("id", experimentId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "実験が見つかりません。" };

  try {
    await assertCanManageLab(ctx, existing.lab_id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "権限がありません。" };
  }

  // Cascades to every dataset, analysis, figure, voice note and notebook
  // entry recorded under this experiment - the same trade-off the lab
  // deletion path makes, at a smaller scope.
  const { error } = await admin.from("experiments").delete().eq("id", experimentId);
  if (error) return { ok: false, error: error.message };

  await logAudit({
    labId: existing.lab_id, userId: ctx.user.id, action: "experiment.admin_deleted",
    entity: "experiment", entityId: experimentId, detail: { name: existing.name },
  });
  revalidatePath("/admin/experiments");
  return { ok: true };
}

export interface AdminNotebookEntry {
  id: string;
  title: string;
  template_slug: string | null;
  created_at: string;
  created_by: string | null;
  body_md: string;
}

/** Lab notes for one experiment — admin client, after manage-lab check. */
export async function adminListNotebookEntries(
  experimentId: string,
): Promise<ActionResult<AdminNotebookEntry[]>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  if (!experimentId) return { ok: true, data: [] };

  const admin = createAdminSupabase();
  const { data: experiment } = await admin
    .from("experiments")
    .select("lab_id")
    .eq("id", experimentId)
    .maybeSingle();
  if (!experiment) return { ok: false, error: "実験が見つかりません。" };

  try {
    await assertCanManageLab(ctx, experiment.lab_id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "権限がありません。" };
  }

  const { data, error } = await admin
    .from("notebook_entries")
    .select("id, title, template_slug, created_at, created_by, body_md")
    .eq("experiment_id", experimentId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data ?? [] };
}
