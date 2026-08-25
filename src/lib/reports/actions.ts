"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { getSessionContext, logAudit } from "@/lib/auth/guards";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

const BUCKET = "lab-reports";
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export interface UploadReportFileInput {
  labId: string;
  experimentId: string;
  kind: "report_preview" | "report_final";
  filename: string;
  mimeType: string;
  /** Base64-encoded file content, no `data:` prefix. */
  base64: string;
}

/**
 * Uploads a generated report PDF and records it as a `raw_files` row.
 *
 * Uploaded through the session-scoped client, not a service-role client, so
 * the `lab-reports` storage policies (see the migration) are what actually
 * authorize the write - not this function's own judgment.
 */
export async function uploadReportFile(
  input: UploadReportFileInput,
): Promise<ActionResult<{ id: string; signedUrl: string }>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  if (!input.labId || !input.experimentId) {
    return { ok: false, error: "実験を選択してください。" };
  }

  const supabase = await createServerSupabase();
  const bytes = Buffer.from(input.base64, "base64");
  const storagePath = `${input.labId}/${input.experimentId}/${Date.now()}_${input.filename}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType: input.mimeType, upsert: false });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { data: row, error: insertError } = await supabase
    .from("raw_files")
    .insert({
      lab_id: input.labId,
      experiment_id: input.experimentId,
      name: input.filename,
      kind: input.kind,
      storage_path: storagePath,
      mime_type: input.mimeType,
      size_bytes: bytes.byteLength,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (insertError) return { ok: false, error: insertError.message };

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed) {
    return { ok: false, error: signError?.message ?? "署名付きURLを作成できませんでした。" };
  }

  await logAudit({
    labId: input.labId, userId: ctx.user.id, action: "report.uploaded",
    entity: "raw_file", entityId: row.id,
    detail: { experiment_id: input.experimentId, kind: input.kind, filename: input.filename },
  });

  return { ok: true, data: { id: row.id, signedUrl: signed.signedUrl } };
}

export interface ReportFileSummary {
  id: string;
  name: string;
  kind: "raw" | "report_preview" | "report_final";
  created_at: string;
  signedUrl: string | null;
}

/** Every report PDF saved for one experiment, newest first. */
export async function listReportFiles(
  experimentId: string,
): Promise<ActionResult<ReportFileSummary[]>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  if (!experimentId) return { ok: true, data: [] };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("raw_files")
    .select("id, name, kind, storage_path, created_at")
    .eq("experiment_id", experimentId)
    .in("kind", ["report_preview", "report_final"])
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return { ok: false, error: error.message };

  const rows = await Promise.all(
    (data ?? []).map(async (r) => {
      let signedUrl: string | null = null;
      if (r.storage_path) {
        const { data: signed } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(r.storage_path, SIGNED_URL_TTL_SECONDS);
        signedUrl = signed?.signedUrl ?? null;
      }
      return { id: r.id, name: r.name, kind: r.kind, created_at: r.created_at, signedUrl };
    }),
  );

  return { ok: true, data: rows };
}

export interface MyReportSummary extends ReportFileSummary {
  experiment_id: string;
  experiment_name: string;
  lab_name: string;
}

type RawReportRow = {
  id: string;
  name: string;
  kind: "raw" | "report_preview" | "report_final";
  storage_path: string | null;
  created_at: string;
  experiment_id: string;
  experiments: { name: string } | { name: string }[] | null;
  laboratories: { name: string } | { name: string }[] | null;
};

/** Signs every row's storage path and flattens the embedded experiment/lab name, shared by every cross-experiment report listing below. */
async function hydrateMyReports(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  rows: RawReportRow[],
): Promise<MyReportSummary[]> {
  return Promise.all(
    rows.map(async (r) => {
      let signedUrl: string | null = null;
      if (r.storage_path) {
        const { data: signed } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(r.storage_path, SIGNED_URL_TTL_SECONDS);
        signedUrl = signed?.signedUrl ?? null;
      }
      const experiment = Array.isArray(r.experiments) ? r.experiments[0] : r.experiments;
      const lab = Array.isArray(r.laboratories) ? r.laboratories[0] : r.laboratories;
      return {
        id: r.id,
        name: r.name,
        kind: r.kind,
        created_at: r.created_at,
        signedUrl,
        experiment_id: r.experiment_id,
        experiment_name: experiment?.name ?? "—",
        lab_name: lab?.name ?? "—",
      };
    }),
  );
}

/**
 * Every report PDF created today (JST), across every laboratory the caller
 * belongs to - not scoped to whichever experiment happens to be selected in
 * the workspace. RLS (`raw_files_select` via `is_lab_member`) is what actually
 * limits this to the caller's own labs; the query itself has no lab filter.
 */
export async function listMyReportsToday(): Promise<ActionResult<MyReportSummary[]>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };

  // JST day boundary, matching how every date in this app's UI is shown
  // (toLocaleDateString("ja-JP")) and how notebook entries' own same-day edit
  // window is computed. Built from Date.UTC rather than the server process's
  // own local timezone (new Date(y, m, d) would use that instead, and is
  // wrong wherever the server does not happen to run in UTC), so JST
  // midnight - "00:00 JST" = "15:00 UTC the previous day" - is exact
  // regardless of where this runs.
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" })
    .format(new Date())
    .split("-")
    .map(Number);
  const startUtcIso = new Date(Date.UTC(y, m - 1, d) - 9 * 60 * 60 * 1000).toISOString();

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("raw_files")
    .select("id, name, kind, storage_path, created_at, experiment_id, experiments(name), laboratories(name)")
    .in("kind", ["report_preview", "report_final"])
    .gte("created_at", startUtcIso)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: await hydrateMyReports(supabase, (data ?? []) as unknown as RawReportRow[]) };
}

export interface MyReportsByExperiment {
  experimentId: string;
  experimentName: string;
  labName: string;
  reports: MyReportSummary[];
}

/**
 * Every report PDF across every laboratory the caller belongs to, grouped by
 * experiment (newest experiment activity first) - the "per experiment" view
 * on the dashboard. `limit` bounds the underlying row scan, not the number of
 * experiment groups, so a very active account still gets a bounded query.
 */
export async function listMyReportsGrouped(
  limit = 200,
): Promise<ActionResult<MyReportsByExperiment[]>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("raw_files")
    .select("id, name, kind, storage_path, created_at, experiment_id, experiments(name), laboratories(name)")
    .in("kind", ["report_preview", "report_final"])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return { ok: false, error: error.message };
  const flat = await hydrateMyReports(supabase, (data ?? []) as unknown as RawReportRow[]);

  const groups = new Map<string, MyReportsByExperiment>();
  for (const r of flat) {
    let group = groups.get(r.experiment_id);
    if (!group) {
      group = {
        experimentId: r.experiment_id,
        experimentName: r.experiment_name,
        labName: r.lab_name,
        reports: [],
      };
      groups.set(r.experiment_id, group);
    }
    group.reports.push(r);
  }

  return { ok: true, data: [...groups.values()] };
}
