"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { getSessionContext, logAudit } from "@/lib/auth/guards";
import type { Reagent } from "@/lib/supabase/types";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface ReagentInput {
  name: string;
  category: string | null;
  vendor: string | null;
  lot: string | null;
  received_at: string | null;
  expires_at: string | null;
  notes: string | null;
}

/** All reagents registered to a laboratory, most recently added first. */
export async function listReagents(labId: string): Promise<ActionResult<Reagent[]>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  if (!labId) return { ok: true, data: [] };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("reagents")
    .select("*")
    .eq("lab_id", labId)
    .order("created_at", { ascending: false });

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data ?? [] };
}

export async function createReagent(
  labId: string,
  input: ReagentInput,
): Promise<ActionResult<Reagent>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  if (!input.name.trim()) return { ok: false, error: "名称を入力してください。" };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("reagents")
    .insert({
      lab_id: labId,
      name: input.name.trim(),
      category: input.category?.trim() || null,
      vendor: input.vendor?.trim() || null,
      lot: input.lot?.trim() || null,
      received_at: input.received_at || null,
      expires_at: input.expires_at || null,
      notes: input.notes?.trim() || null,
      created_by: ctx.user.id,
    })
    .select("*")
    .single();

  if (error) return { ok: false, error: error.message };

  await logAudit({
    labId, userId: ctx.user.id, action: "reagent.created",
    entity: "reagent", entityId: data.id,
    detail: { name: data.name, lot: data.lot },
  });

  return { ok: true, data };
}

export async function updateReagent(
  labId: string,
  id: string,
  input: ReagentInput,
): Promise<ActionResult<Reagent>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  if (!input.name.trim()) return { ok: false, error: "名称を入力してください。" };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("reagents")
    .update({
      name: input.name.trim(),
      category: input.category?.trim() || null,
      vendor: input.vendor?.trim() || null,
      lot: input.lot?.trim() || null,
      received_at: input.received_at || null,
      expires_at: input.expires_at || null,
      notes: input.notes?.trim() || null,
    })
    .eq("id", id)
    .eq("lab_id", labId)
    .select("*")
    .single();

  if (error) return { ok: false, error: error.message };

  await logAudit({
    labId, userId: ctx.user.id, action: "reagent.updated",
    entity: "reagent", entityId: id,
    detail: { name: data.name, lot: data.lot },
  });

  return { ok: true, data };
}

export async function deleteReagent(labId: string, id: string): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("reagents")
    .delete()
    .eq("id", id)
    .eq("lab_id", labId);

  if (error) return { ok: false, error: error.message };

  await logAudit({
    labId, userId: ctx.user.id, action: "reagent.deleted",
    entity: "reagent", entityId: id,
  });

  return { ok: true };
}
