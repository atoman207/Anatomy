"use server";

/**
 * Custom (lab-owned) notebook templates.
 *
 * These live in `notebook_templates` alongside the built-in templates in
 * `templates.ts`, but are created by researchers themselves rather than
 * shipped with the app. Row-level security lets any lab member create and
 * edit them (`can_write_lab`) - "allow users to edit templates as they
 * wish" - while the admin console can reach every lab's templates through
 * the service-role client for oversight.
 */

import { revalidatePath } from "next/cache";
import { createAdminSupabase, createServerSupabase } from "@/lib/supabase/server";
import { getSessionContext, logAudit } from "@/lib/auth/guards";
import { sanitizeFields, slugify } from "./templateFields";
import type { Json, NotebookTemplateRow } from "@/lib/supabase/types";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

export type LabTemplateRow = NotebookTemplateRow & { creator_name: string };

async function creatorNamesById(
  creatorIds: string[],
): Promise<Map<string, string>> {
  if (creatorIds.length === 0) return new Map();
  // profiles_select only returns the caller's own row, so resolve names with
  // the service-role client (same pattern as chat sender names).
  const admin = createAdminSupabase();
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, display_name, email")
    .in("id", creatorIds);
  return new Map(
    (profiles ?? []).map((p) => [
      p.id,
      p.display_name?.trim() || p.email || "不明",
    ]),
  );
}

export interface SaveCustomTemplateInput {
  labId: string;
  name: string;
  description: string;
  category: string;
  body: string;
  fields: unknown;
  /** When set, updates this template instead of creating a new one. */
  templateId?: string;
}

/** Every custom template belonging to one laboratory, newest first. */
export async function listLabTemplates(
  labId: string,
): Promise<ActionResult<LabTemplateRow[]>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  if (!labId) return { ok: true, data: [] };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("notebook_templates")
    .select("*")
    .eq("lab_id", labId)
    .order("created_at", { ascending: false });

  if (error) return { ok: false, error: error.message };

  const creatorIds = [
    ...new Set((data ?? []).map((row) => row.created_by).filter((id): id is string => !!id)),
  ];
  const nameById = await creatorNamesById(creatorIds);
  const rows: LabTemplateRow[] = (data ?? []).map((row) => ({
    ...row,
    creator_name: row.created_by ? nameById.get(row.created_by) ?? "不明" : "不明",
  }));
  return { ok: true, data: rows };
}

/** Creates or updates a custom template. The caller must be able to write to the lab (RLS-enforced). */
export async function saveCustomTemplate(
  input: SaveCustomTemplateInput,
): Promise<ActionResult<NotebookTemplateRow>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  if (!input.labId) return { ok: false, error: "研究室が選択されていません。" };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "テンプレート名を入力してください。" };
  const body = input.body.trim();
  if (!body) return { ok: false, error: "本文を入力してください。" };

  const { fields, error: fieldsError } = sanitizeFields(input.fields);
  if (fieldsError) return { ok: false, error: fieldsError };

  const supabase = await createServerSupabase();
  const payload = {
    lab_id: input.labId,
    name,
    description: input.description.trim() || null,
    category: input.category.trim() || null,
    fields: fields as unknown as Json,
    body,
  };

  if (input.templateId) {
    const { data, error } = await supabase
      .from("notebook_templates")
      .update(payload)
      .eq("id", input.templateId)
      .select("*")
      .single();
    if (error) return { ok: false, error: error.message };

    await logAudit({
      labId: input.labId, userId: ctx.user.id, action: "notebook.template.updated",
      entity: "notebook_template", entityId: data.id, detail: { name },
    });
    revalidatePath("/notebook");
    return { ok: true, data };
  }

  // Slugs are unique per lab; retry with a numeric suffix on collision
  // rather than surfacing a database error for a name that already exists.
  let slug = slugify(name);
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, error } = await supabase
      .from("notebook_templates")
      .insert({ ...payload, slug, created_by: ctx.user.id })
      .select("*")
      .single();
    if (!error) {
      await logAudit({
        labId: input.labId, userId: ctx.user.id, action: "notebook.template.created",
        entity: "notebook_template", entityId: data.id, detail: { name },
      });
      revalidatePath("/notebook");
      return { ok: true, data };
    }
    if (error.code === "23505") {
      slug = `${slugify(name)}-${attempt + 2}`;
      continue;
    }
    return { ok: false, error: error.message };
  }
  return { ok: false, error: "テンプレートを保存できませんでした。" };
}

export async function deleteCustomTemplate(templateId: string): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  if (!templateId) return { ok: false, error: "テンプレートが選択されていません。" };

  const supabase = await createServerSupabase();
  const { data: existing } = await supabase
    .from("notebook_templates")
    .select("lab_id, name")
    .eq("id", templateId)
    .maybeSingle();

  const { error } = await supabase.from("notebook_templates").delete().eq("id", templateId);
  if (error) return { ok: false, error: error.message };

  if (existing) {
    await logAudit({
      labId: existing.lab_id, userId: ctx.user.id, action: "notebook.template.deleted",
      entity: "notebook_template", entityId: templateId, detail: { name: existing.name },
    });
  }
  revalidatePath("/notebook");
  return { ok: true };
}
