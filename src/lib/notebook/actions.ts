"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { getSessionContext, logAudit } from "@/lib/auth/guards";
import type { Json, Reagent } from "@/lib/supabase/types";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface SaveNotebookEntryInput {
  labId: string;
  experimentId: string;
  templateSlug: string | null;
  title: string;
  values: Record<string, unknown>;
  bodyMd: string;
}

/**
 * Saves one notebook entry.
 *
 * Always an insert, never an update: `notebook_entries` is append-only (see
 * the migration), so every save becomes a new, permanent version instead of
 * overwriting what was recorded before. The list a researcher sees is the
 * full history, not just the latest edit.
 */
export async function saveNotebookEntry(
  input: SaveNotebookEntryInput,
): Promise<ActionResult<{ id: string; createdAt: string }>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  const title = input.title.trim();
  if (!title) return { ok: false, error: "タイトルを入力してください。" };
  if (!input.experimentId) return { ok: false, error: "実験を選択してください。" };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("notebook_entries")
    .insert({
      lab_id: input.labId,
      experiment_id: input.experimentId,
      template_slug: input.templateSlug,
      title,
      values: input.values as Json,
      body_md: input.bodyMd,
      created_by: ctx.user.id,
    })
    .select("id, created_at")
    .single();

  if (error) return { ok: false, error: error.message };

  await logAudit({
    labId: input.labId,
    userId: ctx.user.id,
    action: "notebook.entry.saved",
    entity: "notebook_entry",
    entityId: data.id,
    detail: { experiment_id: input.experimentId, title },
  });

  return { ok: true, data: { id: data.id, createdAt: data.created_at } };
}

export interface NotebookEntrySummary {
  id: string;
  title: string;
  template_slug: string | null;
  created_at: string;
  created_by: string | null;
  body_md: string;
}

/** Every saved version for one experiment, newest first. */
export async function listNotebookEntries(
  experimentId: string,
): Promise<ActionResult<NotebookEntrySummary[]>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  if (!experimentId) return { ok: true, data: [] };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("notebook_entries")
    .select("id, title, template_slug, created_at, created_by, body_md")
    .eq("experiment_id", experimentId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data ?? [] };
}

export interface NotebookPrefillContext {
  operator: string;
  previousValues: Record<string, unknown> | null;
  previousSavedAt: string | null;
  reagents: Reagent[];
}

/**
 * Data for "today's notebook" prefill: signed-in operator, the last entry
 * for this experiment + template (stable fields only), and reagent lots.
 */
export async function getNotebookPrefillContext(
  labId: string,
  experimentId: string,
  templateSlug: string,
): Promise<ActionResult<NotebookPrefillContext>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  if (!labId || !experimentId) {
    return {
      ok: true,
      data: {
        operator: ctx.displayName,
        previousValues: null,
        previousSavedAt: null,
        reagents: [],
      },
    };
  }

  const supabase = await createServerSupabase();

  const [entryRes, reagentRes] = await Promise.all([
    supabase
      .from("notebook_entries")
      .select("values, created_at, template_slug")
      .eq("experiment_id", experimentId)
      .eq("template_slug", templateSlug)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("reagents")
      .select("*")
      .eq("lab_id", labId)
      .order("created_at", { ascending: false }),
  ]);

  if (entryRes.error) return { ok: false, error: entryRes.error.message };
  if (reagentRes.error) return { ok: false, error: reagentRes.error.message };

  const prev = entryRes.data;
  const previousValues =
    prev?.values && typeof prev.values === "object" && !Array.isArray(prev.values)
      ? (prev.values as Record<string, unknown>)
      : null;

  return {
    ok: true,
    data: {
      operator: ctx.displayName,
      previousValues,
      previousSavedAt: prev?.created_at ?? null,
      reagents: reagentRes.data ?? [],
    },
  };
}
