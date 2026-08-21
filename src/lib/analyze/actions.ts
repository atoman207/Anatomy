"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { getSessionContext, logAudit } from "@/lib/auth/guards";
import type { AnalysisKind, FigureKind, Json } from "@/lib/supabase/types";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface SaveDatasetInput {
  labId: string;
  experimentId: string;
  name: string;
  sourceFilename: string | null;
  sourceSheet: string | null;
  featureCount: number;
  sampleCount: number;
  matrix: unknown;
  profile: unknown;
  notes: string[];
}

/** Snapshots a loaded dataset so an analysis can always be traced back to it. */
export async function saveDataset(
  input: SaveDatasetInput,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("datasets")
    .insert({
      lab_id: input.labId,
      experiment_id: input.experimentId,
      name: input.name,
      source_filename: input.sourceFilename,
      source_sheet: input.sourceSheet,
      feature_count: input.featureCount,
      sample_count: input.sampleCount,
      matrix: input.matrix as Json,
      profile: (input.profile ?? {}) as Json,
      notes: input.notes as unknown as Json,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  await logAudit({
    labId: input.labId, userId: ctx.user.id, action: "dataset.saved",
    entity: "dataset", entityId: data.id,
    detail: { experiment_id: input.experimentId, name: input.name },
  });

  return { ok: true, data: { id: data.id } };
}

export interface SaveAnalysisInput {
  labId: string;
  experimentId: string;
  datasetId: string | null;
  kind: AnalysisKind;
  title: string | null;
  params: unknown;
  result: unknown;
}

/** Records one analysis run: its method, its exact parameters, and its result. */
export async function saveAnalysis(
  input: SaveAnalysisInput,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("analyses")
    .insert({
      lab_id: input.labId,
      experiment_id: input.experimentId,
      dataset_id: input.datasetId,
      kind: input.kind,
      title: input.title,
      params: input.params as Json,
      result: input.result as Json,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  await logAudit({
    labId: input.labId, userId: ctx.user.id, action: "analysis.saved",
    entity: "analysis", entityId: data.id,
    detail: { experiment_id: input.experimentId, kind: input.kind, title: input.title },
  });

  return { ok: true, data: { id: data.id } };
}

export interface SaveFigureInput {
  labId: string;
  experimentId: string;
  analysisId: string | null;
  kind: FigureKind;
  title: string;
  options: unknown;
  svg: string;
}

/** Records the exact SVG a researcher reviewed, not a pointer to regenerate it later. */
export async function saveFigure(
  input: SaveFigureInput,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("figures")
    .insert({
      lab_id: input.labId,
      experiment_id: input.experimentId,
      analysis_id: input.analysisId,
      kind: input.kind,
      title: input.title,
      options: input.options as Json,
      svg: input.svg,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  await logAudit({
    labId: input.labId, userId: ctx.user.id, action: "figure.saved",
    entity: "figure", entityId: data.id,
    detail: { experiment_id: input.experimentId, kind: input.kind, title: input.title },
  });

  return { ok: true, data: { id: data.id } };
}
