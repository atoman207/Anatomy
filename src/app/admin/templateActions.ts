"use server";

/**
 * Administrator oversight of notebook templates: create, view, edit, and
 * delete any template in any laboratory the caller administers (all labs, for a
 * platform administrator). Everyday editing by the template's own lab stays
 * in `src/lib/notebook/templateActions.ts`, RLS-enforced; these actions
 * additionally re-check `assertCanManageLab` before touching another lab's row.
 */

import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/server";
import { assertCanManageLab, getSessionContext, logAudit } from "@/lib/auth/guards";
import { sanitizeFields, slugify } from "@/lib/notebook/templateFields";
import type { Json, NotebookTemplateRow } from "@/lib/supabase/types";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** Every custom template across every laboratory this admin may manage. */
export async function adminListTemplates(
  labIds: string[] | null,
): Promise<ActionResult<(NotebookTemplateRow & { lab_name: string })[]>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  if (!ctx.canAccessAdmin) return { ok: false, error: "管理権限がありません。" };

  const admin = createAdminSupabase();
  let query = admin
    .from("notebook_templates")
    .select("*, laboratories(name)")
    .order("created_at", { ascending: false });
  if (labIds) {
    if (labIds.length === 0) return { ok: true, data: [] };
    query = query.in("lab_id", labIds);
  }
  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };

  const rows = (data ?? []).map((row) => {
    const embedded = row.laboratories as unknown;
    const lab = (Array.isArray(embedded) ? embedded[0] : embedded) as { name: string } | null;
    // Destructuring to omit `laboratories` from the row before returning it -
    // the binding is intentionally unused, not leftover.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { laboratories: _drop, ...rest } = row as NotebookTemplateRow & {
      laboratories: unknown;
    };
    return { ...rest, lab_name: lab?.name ?? "（不明）" };
  });
  return { ok: true, data: rows };
}

export interface AdminSaveTemplateInput {
  templateId: string;
  name: string;
  description: string;
  category: string;
  body: string;
  fields: unknown;
}

export async function adminUpdateTemplate(
  input: AdminSaveTemplateInput,
): Promise<ActionResult<NotebookTemplateRow>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "テンプレート名を入力してください。" };
  const body = input.body.trim();
  if (!body) return { ok: false, error: "本文を入力してください。" };

  const { fields, error: fieldsError } = sanitizeFields(input.fields);
  if (fieldsError) return { ok: false, error: fieldsError };

  const admin = createAdminSupabase();
  const { data: existing } = await admin
    .from("notebook_templates")
    .select("lab_id")
    .eq("id", input.templateId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "テンプレートが見つかりません。" };

  try {
    await assertCanManageLab(ctx, existing.lab_id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "権限がありません。" };
  }

  const { data, error } = await admin
    .from("notebook_templates")
    .update({
      name,
      description: input.description.trim() || null,
      category: input.category.trim() || null,
      fields: fields as unknown as Json,
      body,
    })
    .eq("id", input.templateId)
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };

  await logAudit({
    labId: existing.lab_id, userId: ctx.user.id, action: "notebook.template.admin_updated",
    entity: "notebook_template", entityId: input.templateId, detail: { name },
  });
  revalidatePath("/admin/templates");
  return { ok: true, data };
}

export async function adminDeleteTemplate(templateId: string): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };

  const admin = createAdminSupabase();
  const { data: existing } = await admin
    .from("notebook_templates")
    .select("lab_id, name")
    .eq("id", templateId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "テンプレートが見つかりません。" };

  try {
    await assertCanManageLab(ctx, existing.lab_id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "権限がありません。" };
  }

  const { error } = await admin.from("notebook_templates").delete().eq("id", templateId);
  if (error) return { ok: false, error: error.message };

  await logAudit({
    labId: existing.lab_id, userId: ctx.user.id, action: "notebook.template.admin_deleted",
    entity: "notebook_template", entityId: templateId, detail: { name: existing.name },
  });
  revalidatePath("/admin/templates");
  return { ok: true };
}

export interface AdminCreateTemplateInput {
  labId: string;
  name: string;
  description: string;
  category: string;
  body: string;
  fields: unknown;
}

/**
 * Creates a template on behalf of a laboratory.
 *
 * The everyday path is a researcher creating their own in `/notebook`; this
 * exists so an administrator can seed a laboratory with a house standard
 * before anyone has joined it, and so administrator template management is
 * genuinely complete rather than edit-and-delete only.
 *
 * Uses the service-role client because an administrator is not necessarily a
 * member of the target lab, so `can_write_lab` - the RLS policy the researcher
 * path relies on - would reject the insert. `assertCanManageLab` takes its
 * place as the authority check.
 */
export async function adminCreateTemplate(
  input: AdminCreateTemplateInput,
): Promise<ActionResult<NotebookTemplateRow>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  if (!input.labId) return { ok: false, error: "研究室を選択してください。" };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "テンプレート名を入力してください。" };
  const body = input.body.trim();
  if (!body) return { ok: false, error: "本文を入力してください。" };

  const { fields, error: fieldsError } = sanitizeFields(input.fields);
  if (fieldsError) return { ok: false, error: fieldsError };

  try {
    await assertCanManageLab(ctx, input.labId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "権限がありません。" };
  }

  const admin = createAdminSupabase();
  const payload = {
    lab_id: input.labId,
    name,
    description: input.description.trim() || null,
    category: input.category.trim() || null,
    fields: fields as unknown as Json,
    body,
    created_by: ctx.user.id,
  };

  // Slugs are unique per lab; retry with a numeric suffix on collision rather
  // than surfacing a database error for a name that already exists.
  let slug = slugify(name);
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, error } = await admin
      .from("notebook_templates")
      .insert({ ...payload, slug })
      .select("*")
      .single();
    if (!error) {
      await logAudit({
        labId: input.labId, userId: ctx.user.id, action: "notebook.template.admin_created",
        entity: "notebook_template", entityId: data.id, detail: { name },
      });
      revalidatePath("/admin/templates");
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
