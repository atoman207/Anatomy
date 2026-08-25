"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { getSessionContext, logAudit } from "@/lib/auth/guards";
import {
  isSubmissionFileKind, MAX_DAILY_SUBMISSION_UPLOAD_BYTES, SUBMISSION_FILE_KINDS,
  type SubmissionFileKind,
} from "./shared";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

const BUCKET = "submission-files";
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * "Today" in JST, as a UTC instant - the same boundary computation used
 * everywhere else in this app that means a Japanese calendar day (the
 * same-day notebook edit lock, the dashboard's "today's reports"), not the
 * server process's own local timezone.
 */
function jstDayStartUtcIso(): string {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" })
    .format(new Date())
    .split("-")
    .map(Number);
  return new Date(Date.UTC(y, m - 1, d) - 9 * 60 * 60 * 1000).toISOString();
}

/** Bytes this account has already uploaded across Figure/Table/Video/Article today (JST). */
async function bytesUploadedToday(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  userId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("raw_files")
    .select("size_bytes")
    .eq("created_by", userId)
    .in("kind", SUBMISSION_FILE_KINDS)
    .gte("created_at", jstDayStartUtcIso());
  if (error || !data) return 0;
  return data.reduce((sum, r) => sum + (r.size_bytes ?? 0), 0);
}

export interface DailyUploadUsage {
  usedBytes: number;
  limitBytes: number;
}

/** For the quota display in the upload UI - independent of which experiment is selected, since the cap is per account. */
export async function getMySubmissionUploadUsage(): Promise<ActionResult<DailyUploadUsage>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };

  const supabase = await createServerSupabase();
  const usedBytes = await bytesUploadedToday(supabase, ctx.user.id);
  return { ok: true, data: { usedBytes, limitBytes: MAX_DAILY_SUBMISSION_UPLOAD_BYTES } };
}

export interface UploadSubmissionFileInput {
  labId: string;
  experimentId: string;
  kind: SubmissionFileKind;
  filename: string;
  mimeType: string;
  /** Base64-encoded file content, no `data:` prefix. */
  base64: string;
}

/**
 * Uploads a Figure/Table/Video/Article file and records it as a `raw_files`
 * row - the same "extract nothing, just catalogue it" shape as
 * uploadReportFile, through the session-scoped client so the
 * submission-files storage policies (see the migration) are the actual
 * authority, not this function's own judgment.
 *
 * The daily-total check is a soft guardrail, not a hard security boundary:
 * it reads then writes without a database-level lock, so two uploads
 * finishing in the same instant could jointly land a few bytes over the
 * cap. That is an acceptable gap for a quota meant to catch an accidental
 * large upload, not to meter a shared resource precisely.
 */
export async function uploadSubmissionFile(
  input: UploadSubmissionFileInput,
): Promise<ActionResult<{ id: string; signedUrl: string }>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  if (!input.labId || !input.experimentId) {
    return { ok: false, error: "実験を選択してください。" };
  }
  if (!isSubmissionFileKind(input.kind)) {
    return { ok: false, error: "ファイルの種類が不正です。" };
  }
  const filename = input.filename.trim();
  if (!filename) return { ok: false, error: "ファイル名がありません。" };

  const supabase = await createServerSupabase();
  const bytes = Buffer.from(input.base64, "base64");
  if (bytes.byteLength === 0) return { ok: false, error: "ファイルが空です。" };

  const usedToday = await bytesUploadedToday(supabase, ctx.user.id);
  if (usedToday + bytes.byteLength > MAX_DAILY_SUBMISSION_UPLOAD_BYTES) {
    const remaining = Math.max(0, MAX_DAILY_SUBMISSION_UPLOAD_BYTES - usedToday);
    return {
      ok: false,
      error:
        `本日の投稿用ファイルのアップロード上限（${(MAX_DAILY_SUBMISSION_UPLOAD_BYTES / 1024 ** 2).toFixed(0)}MB）` +
        `に達します。本日あと ${(remaining / 1024).toFixed(0)}KB アップロードできます。`,
    };
  }

  const storagePath = `${input.labId}/${input.experimentId}/${input.kind}/${Date.now()}_${filename}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType: input.mimeType, upsert: false });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { data: row, error: insertError } = await supabase
    .from("raw_files")
    .insert({
      lab_id: input.labId,
      experiment_id: input.experimentId,
      name: filename,
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
    labId: input.labId, userId: ctx.user.id, action: "submission_file.uploaded",
    entity: "raw_file", entityId: row.id,
    detail: { experiment_id: input.experimentId, kind: input.kind, filename, size_bytes: bytes.byteLength },
  });

  return { ok: true, data: { id: row.id, signedUrl: signed.signedUrl } };
}

export interface SubmissionFileSummary {
  id: string;
  name: string;
  kind: SubmissionFileKind;
  size_bytes: number | null;
  created_at: string;
  signedUrl: string | null;
}

/** Every Figure/Table/Video/Article file saved for one experiment, newest first. */
export async function listSubmissionFiles(
  experimentId: string,
): Promise<ActionResult<SubmissionFileSummary[]>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  if (!experimentId) return { ok: true, data: [] };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("raw_files")
    .select("id, name, kind, storage_path, size_bytes, created_at")
    .eq("experiment_id", experimentId)
    .in("kind", SUBMISSION_FILE_KINDS)
    .order("created_at", { ascending: false });

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
      return {
        id: r.id,
        name: r.name,
        kind: r.kind as SubmissionFileKind,
        size_bytes: r.size_bytes,
        created_at: r.created_at,
        signedUrl,
      };
    }),
  );

  return { ok: true, data: rows };
}

/** Deletes one submission file's storage object and row. RLS (can_write_lab) is the actual authority. */
export async function deleteSubmissionFile(id: string): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };

  const supabase = await createServerSupabase();
  const { data: row, error: readError } = await supabase
    .from("raw_files")
    .select("id, lab_id, storage_path")
    .eq("id", id)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!row) return { ok: false, error: "ファイルが見つかりません。" };

  if (row.storage_path) {
    await supabase.storage.from(BUCKET).remove([row.storage_path]);
  }
  const { error: deleteError } = await supabase.from("raw_files").delete().eq("id", id);
  if (deleteError) return { ok: false, error: deleteError.message };

  await logAudit({
    labId: row.lab_id, userId: ctx.user.id, action: "submission_file.deleted",
    entity: "raw_file", entityId: id, detail: {},
  });

  return { ok: true };
}
