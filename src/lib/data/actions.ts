"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { getSessionContext, logAudit } from "@/lib/auth/guards";
import type { Json } from "@/lib/supabase/types";
import type { RawFileInventory } from "./rawfiles";
import type { SampleSheet } from "./samplesheet";
import type { RenamePreview } from "./rename";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** Records the raw file inventory as it stood at import time. */
export async function saveRawFileInventory(
  labId: string,
  experimentId: string,
  inventory: RawFileInventory,
): Promise<ActionResult<{ count: number }>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  if (!inventory.entries.length) return { ok: false, error: "ファイルがありません。" };

  const supabase = await createServerSupabase();
  const rows = inventory.entries.map((e) => ({
    lab_id: labId,
    experiment_id: experimentId,
    name: e.name,
    stem: e.stem || null,
    extension: e.extension || null,
    platform: e.platform || null,
    path: e.path,
    size_bytes: e.size,
    modified_at: e.modified,
    inferred_sample: e.inferredSample,
    inferred_group: e.inferredGroup,
    inferred_replicate: e.inferredReplicate,
    inferred_batch: e.inferredBatch,
    inferred_order: e.inferredOrder,
    issues: e.issues as Json,
  }));

  const { error } = await supabase.from("raw_files").insert(rows);
  if (error) return { ok: false, error: error.message };

  await logAudit({
    labId, userId: ctx.user.id, action: "raw_files.saved",
    entity: "experiment", entityId: experimentId,
    detail: { count: rows.length },
  });

  return { ok: true, data: { count: rows.length } };
}

/** Records one version of the sample sheet. Every save is a new row. */
export async function saveSampleSheet(
  labId: string,
  experimentId: string,
  sheet: SampleSheet,
  name = "サンプルシート",
): Promise<ActionResult<{ id: string }>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("sample_sheets")
    .insert({
      lab_id: labId,
      experiment_id: experimentId,
      name,
      rows: sheet.rows as unknown as Json,
      extra_columns: sheet.extraColumns as unknown as Json,
      issues: sheet.issues as unknown as Json,
      is_valid: sheet.valid,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  await logAudit({
    labId, userId: ctx.user.id, action: "sample_sheet.saved",
    entity: "sample_sheet", entityId: data.id,
    detail: { experiment_id: experimentId, rows: sheet.rows.length, valid: sheet.valid },
  });

  return { ok: true, data: { id: data.id } };
}

/**
 * Records a rename plan as reviewed, not applied. chondro never touches the
 * filesystem, so `applied` always stays false here - the record is proof of
 * what was planned, for whoever runs the generated script by hand.
 */
export async function saveRenameOperation(
  labId: string,
  experimentId: string,
  rules: unknown,
  preview: RenamePreview,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };

  const supabase = await createServerSupabase();
  const mapping = preview.rows
    .filter((r) => r.changed)
    .map((r) => ({ from: r.original, to: r.proposed }));

  const { data, error } = await supabase
    .from("rename_operations")
    .insert({
      lab_id: labId,
      experiment_id: experimentId,
      rules: rules as Json,
      mapping: mapping as unknown as Json,
      file_count: mapping.length,
      applied: false,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  await logAudit({
    labId, userId: ctx.user.id, action: "rename_operation.saved",
    entity: "rename_operation", entityId: data.id,
    detail: { experiment_id: experimentId, file_count: mapping.length },
  });

  return { ok: true, data: { id: data.id } };
}
