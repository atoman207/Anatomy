"use server";

import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/server";
import { getSessionContext, logAudit } from "@/lib/auth/guards";
import { CONTENT_KINDS, isLockedRow, type ContentKind } from "./contentTypes";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** Every row is capped at this many results; the manager is a moderation tool, not a data export. */
const LIST_LIMIT = 200;

function isContentKind(v: unknown): v is ContentKind {
  return typeof v === "string" && (CONTENT_KINDS as readonly string[]).includes(v);
}

async function platformAdminContext() {
  const ctx = await getSessionContext();
  if (!ctx) throw new Error("ログインしていません。");
  if (!ctx.isPlatformAdmin) {
    throw new Error("この操作はシステム管理者のみ実行できます。");
  }
  return ctx;
}

export type ContentRow = Record<string, unknown> & { id: string; lab_id: string };

/**
 * Every row of one content type, newest first, across every laboratory.
 *
 * Platform-admin only, and deliberately capped at `LIST_LIMIT`: this page is
 * for finding and removing a specific problem record, not for exporting a
 * table wholesale - a researcher who needs their own lab's data already has
 * it, in their own lab's pages.
 */
export async function adminListContent(
  kind: string,
  labId?: string | null,
): Promise<ActionResult<ContentRow[]>> {
  try {
    await platformAdminContext();
    if (!isContentKind(kind)) return { ok: false, error: "対象の種類が不正です。" };

    const admin = createAdminSupabase();
    let query = admin
      .from(kind)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT);
    if (labId) query = query.eq("lab_id", labId);

    const { data, error } = await query;
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: (data ?? []) as ContentRow[] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "取得できませんでした。" };
  }
}

/**
 * Deletes one row.
 *
 * For `notebook_entries` and confirmed `voice_notes` this is an explicit
 * override of the append-only guarantee those two tables otherwise enforce
 * for every ordinary user - RLS gives them no update or delete policy at
 * all, and a confirmed voice note is additionally locked by a database
 * trigger against edits. Neither blocks the service-role client this
 * function uses, which is exactly why the override is possible here and
 * nowhere else: the only way to reach this code path is
 * `getSessionContext().isPlatformAdmin`, re-checked on every call, never a
 * client-side flag.
 */
export async function adminDeleteContent(kind: string, id: string): Promise<ActionResult> {
  try {
    const ctx = await platformAdminContext();
    if (!isContentKind(kind)) return { ok: false, error: "対象の種類が不正です。" };
    if (!id) return { ok: false, error: "対象が指定されていません。" };

    const admin = createAdminSupabase();
    const { data: existing } = await admin
      .from(kind)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!existing) return { ok: false, error: "レコードが見つかりません。" };

    const locked = isLockedRow(kind, existing as Record<string, unknown>);

    const { error } = await admin.from(kind).delete().eq("id", id);
    if (error) return { ok: false, error: error.message };

    await logAudit({
      labId: (existing as { lab_id?: string }).lab_id ?? null,
      userId: ctx.user.id,
      action: locked ? "content.protected_record_deleted" : "content.deleted",
      entity: kind,
      entityId: id,
      detail: { kind, protected_override: locked },
    });

    revalidatePath("/admin/content");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "削除できませんでした。" };
  }
}

export interface LabContentUsage {
  labId: string;
  labName: string;
  counts: Record<ContentKind, number>;
  total: number;
}

/**
 * Row counts for every content type, broken down by laboratory.
 *
 * One `count: "exact", head: true` query per table per lab would be
 * `labs × 11` round trips; instead this pulls `lab_id` alone from every
 * table once and counts in memory, which is one round trip per content type
 * regardless of how many laboratories exist.
 */
export async function adminContentUsage(): Promise<ActionResult<LabContentUsage[]>> {
  try {
    await platformAdminContext();
    const admin = createAdminSupabase();

    const { data: labs, error: labsError } = await admin
      .from("laboratories")
      .select("id, name")
      .order("name", { ascending: true });
    if (labsError) return { ok: false, error: labsError.message };

    const usageByLab = new Map<string, Record<ContentKind, number>>();
    for (const lab of labs ?? []) {
      usageByLab.set(lab.id, Object.fromEntries(CONTENT_KINDS.map((k) => [k, 0])) as Record<ContentKind, number>);
    }

    for (const kind of CONTENT_KINDS) {
      const { data: rows, error } = await admin.from(kind).select("lab_id");
      if (error) return { ok: false, error: error.message };
      for (const row of rows ?? []) {
        const labId = (row as { lab_id: string }).lab_id;
        const counts = usageByLab.get(labId);
        if (counts) counts[kind] += 1;
      }
    }

    const result: LabContentUsage[] = (labs ?? []).map((lab) => {
      const counts = usageByLab.get(lab.id)!;
      const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
      return { labId: lab.id, labName: lab.name, counts, total };
    });

    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "集計できませんでした。" };
  }
}
