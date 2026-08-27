"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import {
  assertCanRecordOnExperiment,
  getSessionContext,
  logAudit,
} from "@/lib/auth/guards";
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
 * Saves a new notebook entry.
 *
 * Always an insert - `updateNotebookEntry` below is the separate path for
 * revising one created earlier today. Once that day has passed, the entry
 * is permanently fixed: `lock_stale_notebook_entry` enforces that at the
 * database itself, not just in this function.
 */
export async function saveNotebookEntry(
  input: SaveNotebookEntryInput,
): Promise<ActionResult<{ id: string; createdAt: string }>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  const title = input.title.trim();
  if (!title) return { ok: false, error: "タイトルを入力してください。" };
  if (!input.experimentId) return { ok: false, error: "実験を選択してください。" };

  try {
    await assertCanRecordOnExperiment(ctx, input.experimentId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "権限がありません。" };
  }

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

export interface UpdateNotebookEntryInput {
  id: string;
  title: string;
  values: Record<string, unknown>;
  bodyMd: string;
}

/**
 * Revises an entry created earlier today.
 *
 * The RLS policy allows the update unconditionally for a lab writer, and it
 * is `lock_stale_notebook_entry` - a trigger, not this function - that
 * actually refuses one for a past day. That is deliberate: the trigger runs
 * for every writer including a service-role admin tool, so the boundary
 * cannot be worked around by calling the database a different way. This
 * function's own error message exists only to translate that failure into
 * Japanese rather than surfacing Postgres's raw exception text.
 */
export async function updateNotebookEntry(
  input: UpdateNotebookEntryInput,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  const title = input.title.trim();
  if (!title) return { ok: false, error: "タイトルを入力してください。" };

  const supabase = await createServerSupabase();
  const { data: existing } = await supabase
    .from("notebook_entries")
    .select("id, lab_id, experiment_id, created_by")
    .eq("id", input.id)
    .maybeSingle();
  if (!existing) {
    return { ok: false, error: "この記録は編集できません（作成日を過ぎているか、権限がありません）。" };
  }
  if (existing.created_by !== ctx.user.id) {
    return {
      ok: false,
      error: "自分が書いたノートのみ編集できます。研究室の作成者は閲覧のみ可能です。",
    };
  }

  const { data, error } = await supabase
    .from("notebook_entries")
    .update({ title, values: input.values as Json, body_md: input.bodyMd })
    .eq("id", input.id)
    .eq("created_by", ctx.user.id)
    .select("id, lab_id, experiment_id")
    .maybeSingle();

  if (error) {
    if (/作成日を過ぎている/.test(error.message)) return { ok: false, error: error.message };
    return { ok: false, error: "更新に失敗しました。" };
  }
  if (!data) return { ok: false, error: "この記録は編集できません（作成日を過ぎているか、権限がありません）。" };

  await logAudit({
    labId: data.lab_id,
    userId: ctx.user.id,
    action: "notebook.entry.updated",
    entity: "notebook_entry",
    entityId: data.id,
    detail: { experiment_id: data.experiment_id, title },
  });

  return { ok: true, data: { id: data.id } };
}

export interface NotebookEntrySummary {
  id: string;
  title: string;
  template_slug: string | null;
  created_at: string;
  created_by: string | null;
  body_md: string;
  values: Record<string, unknown>;
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
    .select("id, title, template_slug, created_at, created_by, body_md, values")
    .eq("experiment_id", experimentId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return { ok: false, error: error.message };
  const rows: NotebookEntrySummary[] = (data ?? []).map((r) => ({
    ...r,
    values:
      r.values && typeof r.values === "object" && !Array.isArray(r.values)
        ? (r.values as Record<string, unknown>)
        : {},
  }));
  return { ok: true, data: rows };
}

function jstDayStartIso(now = new Date()): string {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" })
    .format(now)
    .split("-")
    .map(Number);
  return new Date(Date.UTC(y, m - 1, d) - 9 * 60 * 60 * 1000).toISOString();
}

export interface MyNotebookEntrySummary {
  id: string;
  title: string;
  created_at: string;
  experiment_id: string;
  experiment_name: string;
  lab_id: string;
  lab_name: string;
  template_slug: string | null;
}

export interface MyNotebookEntriesByExperiment {
  experimentId: string;
  experimentName: string;
  labId: string;
  labName: string;
  entries: MyNotebookEntrySummary[];
}

type NotebookJoinRow = {
  id: string;
  title: string;
  created_at: string;
  experiment_id: string;
  lab_id: string;
  template_slug: string | null;
  experiments: { name: string } | { name: string }[] | null;
  laboratories: { name: string } | { name: string }[] | null;
};

function mapNotebookJoinRow(r: NotebookJoinRow): MyNotebookEntrySummary {
  const experiment = Array.isArray(r.experiments) ? r.experiments[0] : r.experiments;
  const lab = Array.isArray(r.laboratories) ? r.laboratories[0] : r.laboratories;
  return {
    id: r.id,
    title: r.title,
    created_at: r.created_at,
    experiment_id: r.experiment_id,
    experiment_name: experiment?.name ?? "—",
    lab_id: r.lab_id,
    lab_name: lab?.name ?? "—",
    template_slug: r.template_slug,
  };
}

/**
 * Lab reports the caller wrote today (JST) — same source as the header's
 * 「今日の実験記録を見る」count (`notebook_entries`), not PDF uploads.
 */
export async function listMyNotebookEntriesToday(): Promise<ActionResult<MyNotebookEntrySummary[]>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("notebook_entries")
    .select("id, title, created_at, experiment_id, lab_id, template_slug, experiments(name), laboratories(name)")
    .eq("created_by", ctx.user.id)
    .gte("created_at", jstDayStartIso())
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    data: ((data ?? []) as unknown as NotebookJoinRow[]).map(mapNotebookJoinRow),
  };
}

/**
 * Every lab report the caller has written, grouped by experiment (newest
 * activity first). Matches the dashboard's "すべてのラボレポート" section to
 * the same `notebook_entries` the header already counts.
 */
export async function listMyNotebookEntriesGrouped(
  limit = 200,
): Promise<ActionResult<MyNotebookEntriesByExperiment[]>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("notebook_entries")
    .select("id, title, created_at, experiment_id, lab_id, template_slug, experiments(name), laboratories(name)")
    .eq("created_by", ctx.user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return { ok: false, error: error.message };

  const groups = new Map<string, MyNotebookEntriesByExperiment>();
  for (const raw of (data ?? []) as unknown as NotebookJoinRow[]) {
    const entry = mapNotebookJoinRow(raw);
    let group = groups.get(entry.experiment_id);
    if (!group) {
      group = {
        experimentId: entry.experiment_id,
        experimentName: entry.experiment_name,
        labId: entry.lab_id,
        labName: entry.lab_name,
        entries: [],
      };
      groups.set(entry.experiment_id, group);
    }
    group.entries.push(entry);
  }

  return { ok: true, data: [...groups.values()] };
}

export interface MyNotebookEntryDetail extends MyNotebookEntrySummary {
  body_md: string;
}

/**
 * Full lab-report body for preview / PDF. Only the author can load it —
 * same scope as the dashboard lists.
 */
export async function getMyNotebookEntry(
  entryId: string,
): Promise<ActionResult<MyNotebookEntryDetail>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  if (!entryId) return { ok: false, error: "レポートが指定されていません。" };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("notebook_entries")
    .select(
      "id, title, created_at, experiment_id, lab_id, template_slug, body_md, created_by, experiments(name), laboratories(name)",
    )
    .eq("id", entryId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "レポートが見つかりません。" };
  if (data.created_by !== ctx.user.id && !ctx.isPlatformAdmin) {
    return { ok: false, error: "このレポートを表示する権限がありません。" };
  }

  const mapped = mapNotebookJoinRow(data as unknown as NotebookJoinRow);
  return {
    ok: true,
    data: {
      ...mapped,
      body_md: data.body_md ?? "",
    },
  };
}

export interface NotebookPrefillContext {
  operator: string;
  previousValues: Record<string, unknown> | null;
  previousSavedAt: string | null;
  reagents: Reagent[];
}

/**
 * Data for "today's notebook" prefill: signed-in operator, the last entry
 * for this experiment + template (stable fields only), and reagent lots
 * from that same experiment.
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
      .eq("experiment_id", experimentId)
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
