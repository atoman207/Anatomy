"use server";

import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/server";
import {
  assertCanManageLab, assertIsLabOwner, getSessionContext, logAudit,
} from "@/lib/auth/guards";
import { getOwnerMaxLabs } from "@/lib/billing/subscription";
import { formatUsage } from "@/lib/billing/plans";
import { LAB_ROLES, LAB_ROLE_LABELS } from "@/lib/auth/roles";
import type { LabRole } from "@/lib/supabase/types";

/**
 * User-facing laboratory management.
 *
 * Distinct from `src/app/admin/actions.ts`, which is the platform
 * Administrator's toolset (any laboratory, no ownership required). These
 * actions are what an ordinary signed-in user reaches from `/labs`: create a
 * laboratory, invite people into one they already own or administer, and
 * manage its membership. Authority is always re-derived from
 * `lab_members.role`, never trusted from the browser.
 */

export interface ActionResult {
  ok: boolean;
  message: string;
}

const fail = (message: string): ActionResult => ({ ok: false, message });
const done = (message: string): ActionResult => ({ ok: true, message });

async function ctxOrThrow() {
  const ctx = await getSessionContext();
  if (!ctx) throw new Error("サインインしていません。");
  return ctx;
}

function parseRole(value: FormDataEntryValue | null): LabRole | null {
  const s = String(value ?? "");
  return (LAB_ROLES as string[]).includes(s) ? (s as LabRole) : null;
}

function normalizeEmail(value: FormDataEntryValue | null): string {
  return String(value ?? "").trim().toLowerCase();
}

/** Finds an auth user by email, paging until found. */
async function findUserByEmail(email: string) {
  const admin = createAdminSupabase();
  let page = 1;
  while (page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
    page++;
  }
  return null;
}

function refreshLabsPages(labId?: string) {
  revalidatePath("/labs");
  revalidatePath("/", "layout");
  if (labId) revalidatePath(`/experiments`);
}

/* ------------------------------------------------------------------ */
/* Laboratory creation & settings                                      */
/* ------------------------------------------------------------------ */

/**
 * Creates a laboratory for collaborative research. Open to any signed-in
 * user - the creator becomes its owner, exactly as a platform administrator
 * creating one from `/admin/labs` does, just without that gate.
 */
export async function createLabAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow();
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || null;
    if (!name) return fail("研究室名を入力してください。");
    if (name.length > 120) return fail("名称が長すぎます（最大120文字）。");

    const admin = createAdminSupabase();
    const { count: ownedCount } = await admin
      .from("lab_members")
      .select("lab_id", { count: "exact", head: true })
      .eq("user_id", ctx.user.id)
      .eq("role", "owner");
    const maxLabs = await getOwnerMaxLabs(ctx.user.id);
    const owned = ownedCount ?? 0;
    if (maxLabs !== null && owned >= maxLabs) {
      return fail(
        `オーナーとして作成できる研究室は ${formatUsage(owned, maxLabs)} までです。` +
          "プランをアップグレードするか、不要な研究室を整理してください。",
      );
    }

    const { data: lab, error } = await admin
      .from("laboratories")
      .insert({ name, description, owner_id: ctx.user.id })
      .select("id")
      .single();
    if (error) return fail(error.message);

    const member = await admin
      .from("lab_members")
      .insert({ lab_id: lab.id, user_id: ctx.user.id, role: "owner" });
    if (member.error) {
      // Roll back so a lab without an owner never exists.
      await admin.from("laboratories").delete().eq("id", lab.id);
      return fail(member.error.message);
    }

    await logAudit({
      labId: lab.id, userId: ctx.user.id, action: "lab.created",
      entity: "laboratory", entityId: lab.id, detail: { name },
    });

    refreshLabsPages();
    return done(`研究室「${name}」を作成しました。あなたがオーナーです。`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "研究室を作成できませんでした。");
  }
}

export async function updateLabAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow();
    const labId = String(formData.get("lab_id") ?? "");
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || null;
    if (!labId) return fail("研究室が選択されていません。");
    if (!name) return fail("研究室名を入力してください。");
    await assertCanManageLab(ctx, labId);

    const admin = createAdminSupabase();
    const { error } = await admin
      .from("laboratories")
      .update({ name, description })
      .eq("id", labId);
    if (error) return fail(error.message);

    await logAudit({
      labId, userId: ctx.user.id, action: "lab.updated",
      entity: "laboratory", entityId: labId, detail: { name },
    });

    refreshLabsPages(labId);
    return done("研究室情報を更新しました。");
  } catch (e) {
    return fail(e instanceof Error ? e.message : "研究室を更新できませんでした。");
  }
}

export async function deleteLabAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow();
    const labId = String(formData.get("lab_id") ?? "");
    const confirm = String(formData.get("confirm") ?? "");
    if (!labId) return fail("研究室が選択されていません。");
    await assertIsLabOwner(ctx, labId);

    const admin = createAdminSupabase();
    const { data: lab } = await admin
      .from("laboratories").select("name").eq("id", labId).maybeSingle();
    if (!lab) return fail("研究室が見つかりません。");

    if (confirm !== lab.name) {
      return fail(`削除を確認するため、研究室名「${lab.name}」を正確に入力してください。`);
    }

    const counts = await countLabContents(labId);
    const { error } = await admin.from("laboratories").delete().eq("id", labId);
    if (error) return fail(error.message);

    await logAudit({
      labId: null, userId: ctx.user.id, action: "lab.deleted",
      entity: "laboratory", entityId: labId,
      detail: { name: lab.name, deleted: counts },
    });

    refreshLabsPages();
    return done(`研究室「${lab.name}」を削除しました。`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "研究室を削除できませんでした。");
  }
}

async function countLabContents(labId: string): Promise<Record<string, number>> {
  const admin = createAdminSupabase();
  const tables = ["experiments", "datasets", "analyses", "figures", "notebook_entries"] as const;
  const out: Record<string, number> = {};
  for (const t of tables) {
    const { count } = await admin
      .from(t)
      .select("id", { count: "exact", head: false })
      .eq("lab_id", labId)
      .limit(1);
    out[t] = count ?? 0;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Membership                                                          */
/* ------------------------------------------------------------------ */

/**
 * Invites someone into a laboratory the caller owns or administers.
 *
 * An email with an existing account is added directly. One with no account
 * gets a pending row in `lab_invites` plus a Supabase invitation email; the
 * pending row is what lets the auth callback finish the job automatically
 * the moment that person confirms their account, instead of requiring the
 * inviter to come back and add them a second time.
 */
export async function inviteLabMemberAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow();
    const labId = String(formData.get("lab_id") ?? "");
    const email = normalizeEmail(formData.get("email"));
    const role = parseRole(formData.get("role")) ?? "member";

    if (!labId) return fail("研究室が選択されていません。");
    if (!email.includes("@")) return fail("有効なメールアドレスを入力してください。");
    if (role === "owner") {
      return fail("オーナー権限は譲渡でのみ付与できます。「オーナーの譲渡」を使用してください。");
    }
    await assertCanManageLab(ctx, labId);

    const admin = createAdminSupabase();
    const existing = await findUserByEmail(email);

    if (existing) {
      const { data: already } = await admin
        .from("lab_members")
        .select("user_id, role")
        .eq("lab_id", labId)
        .eq("user_id", existing.id)
        .maybeSingle();

      if (already) {
        const roleJa = LAB_ROLE_LABELS[already.role as LabRole]?.ja ?? already.role;
        return fail(`${email} はすでにこの研究室の${roleJa}です。`);
      }

      const { error } = await admin
        .from("lab_members")
        .insert({ lab_id: labId, user_id: existing.id, role });
      if (error) return fail(error.message);

      await logAudit({
        labId, userId: ctx.user.id, action: "member.added",
        entity: "lab_member", entityId: existing.id, detail: { email, role },
      });

      refreshLabsPages(labId);
      return done(`${email} を${LAB_ROLE_LABELS[role].ja}として追加しました。`);
    }

    // No account yet: keep the promise in lab_invites so it survives until
    // they sign up, then ask Supabase to send the invitation email.
    const { data: pending } = await admin
      .from("lab_invites")
      .select("id")
      .eq("lab_id", labId)
      .eq("email", email)
      .is("accepted_at", null)
      .maybeSingle();

    if (pending) {
      const { error: updateError } = await admin
        .from("lab_invites")
        .update({ role, invited_by: ctx.user.id })
        .eq("id", pending.id);
      if (updateError) return fail(updateError.message);
    } else {
      const { error: insertError } = await admin
        .from("lab_invites")
        .insert({ lab_id: labId, email, role, invited_by: ctx.user.id });
      if (insertError) return fail(insertError.message);
    }

    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: site ? `${site}/auth/callback?next=/labs` : undefined,
    });
    if (error) {
      return fail(
        `${email} 宛の招待は保存しましたが、招待メールを送信できませんでした: ${error.message}。` +
          "本人にサインアップを依頼してください。サインアップが完了すれば自動的に研究室へ追加されます。",
      );
    }

    await logAudit({
      labId, userId: ctx.user.id, action: "member.invited",
      entity: "lab_member", detail: { email, role },
    });

    refreshLabsPages(labId);
    return done(`${email} に招待メールを送信しました。登録が完了すると自動的に研究室に追加されます。`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "招待できませんでした。");
  }
}

export async function cancelLabInviteAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow();
    const labId = String(formData.get("lab_id") ?? "");
    const inviteId = String(formData.get("invite_id") ?? "");
    if (!labId || !inviteId) return fail("招待が指定されていません。");
    await assertCanManageLab(ctx, labId);

    const admin = createAdminSupabase();
    const { error } = await admin
      .from("lab_invites")
      .delete()
      .eq("id", inviteId)
      .eq("lab_id", labId)
      .is("accepted_at", null);
    if (error) return fail(error.message);

    refreshLabsPages(labId);
    return done("招待を取り消しました。");
  } catch (e) {
    return fail(e instanceof Error ? e.message : "招待を取り消せませんでした。");
  }
}

export async function changeLabMemberRoleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow();
    const labId = String(formData.get("lab_id") ?? "");
    const userId = String(formData.get("user_id") ?? "");
    const role = parseRole(formData.get("role"));

    if (!labId || !userId) return fail("研究室またはユーザーが指定されていません。");
    if (!role) return fail("不明な役割です。");
    await assertCanManageLab(ctx, labId);

    const admin = createAdminSupabase();
    const { data: target } = await admin
      .from("lab_members")
      .select("role")
      .eq("lab_id", labId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!target) return fail("そのユーザーはこの研究室のメンバーではありません。");
    if (target.role === "owner") {
      return fail("オーナーの役割はここでは変更できません。譲渡を使用してください。");
    }
    if (role === "owner") {
      return fail("オーナーにするには「譲渡」を使用してください。");
    }
    if (userId === ctx.user.id) {
      return fail("自分自身の役割は変更できません。");
    }

    const { error } = await admin
      .from("lab_members")
      .update({ role })
      .eq("lab_id", labId)
      .eq("user_id", userId);
    if (error) return fail(error.message);

    await logAudit({
      labId, userId: ctx.user.id, action: "member.role_changed",
      entity: "lab_member", entityId: userId,
      detail: { from: target.role, to: role },
    });

    refreshLabsPages(labId);
    return done(`権限を${LAB_ROLE_LABELS[role].ja}に変更しました。`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "役割を変更できませんでした。");
  }
}

export async function removeLabMemberAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow();
    const labId = String(formData.get("lab_id") ?? "");
    const userId = String(formData.get("user_id") ?? "");
    if (!labId || !userId) return fail("研究室またはユーザーが指定されていません。");
    await assertCanManageLab(ctx, labId);

    const admin = createAdminSupabase();
    const { data: target } = await admin
      .from("lab_members")
      .select("role")
      .eq("lab_id", labId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!target) return fail("そのユーザーはこの研究室のメンバーではありません。");
    if (target.role === "owner") {
      return fail("オーナーは削除できません。先にオーナー権限を譲渡してください。");
    }

    const { error } = await admin
      .from("lab_members")
      .delete()
      .eq("lab_id", labId)
      .eq("user_id", userId);
    if (error) return fail(error.message);

    await logAudit({
      labId, userId: ctx.user.id, action: "member.removed",
      entity: "lab_member", entityId: userId, detail: { role: target.role },
    });

    refreshLabsPages(labId);
    return done("メンバーを削除しました。データは研究室に残ります。");
  } catch (e) {
    return fail(e instanceof Error ? e.message : "メンバーを削除できませんでした。");
  }
}

export async function transferLabOwnershipAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow();
    const labId = String(formData.get("lab_id") ?? "");
    const userId = String(formData.get("user_id") ?? "");
    const confirm = String(formData.get("confirm") ?? "");
    if (!labId || !userId) return fail("研究室またはユーザーが指定されていません。");
    await assertIsLabOwner(ctx, labId);
    if (confirm !== "譲渡") {
      return fail("確認のため「譲渡」と入力してください。新しいオーナーが譲り返さない限り取り消せません。");
    }

    const admin = createAdminSupabase();
    const { data: lab } = await admin
      .from("laboratories")
      .select("owner_id, name")
      .eq("id", labId)
      .maybeSingle();
    if (!lab) return fail("研究室が見つかりません。");

    const { data: target } = await admin
      .from("lab_members")
      .select("role")
      .eq("lab_id", labId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!target) return fail("新しいオーナーはすでにメンバーである必要があります。");

    const promote = await admin
      .from("lab_members").update({ role: "owner" })
      .eq("lab_id", labId).eq("user_id", userId);
    if (promote.error) return fail(promote.error.message);

    const updateLab = await admin
      .from("laboratories").update({ owner_id: userId }).eq("id", labId);
    if (updateLab.error) return fail(updateLab.error.message);

    const previousOwner = lab.owner_id;
    if (previousOwner && previousOwner !== userId) {
      await admin
        .from("lab_members").update({ role: "admin" })
        .eq("lab_id", labId).eq("user_id", previousOwner);
    }

    await logAudit({
      labId, userId: ctx.user.id, action: "lab.ownership_transferred",
      entity: "laboratory", entityId: labId,
      detail: { from: previousOwner, to: userId },
    });

    refreshLabsPages(labId);
    return done("オーナーを変更しました。あなたは管理者になりました。");
  } catch (e) {
    return fail(e instanceof Error ? e.message : "オーナー権限を譲渡できませんでした。");
  }
}

/* ------------------------------------------------------------------ */
/* Invite acceptance                                                    */
/* ------------------------------------------------------------------ */

/**
 * Consumes every pending invite addressed to this email, adding the freshly
 * confirmed account to each laboratory at the role it was promised.
 *
 * Called from the auth callback right after a session is established, so an
 * invited colleague lands in their laboratory the moment they finish signing
 * up - the inviter never has to come back and add them by hand. Runs with
 * the service-role client: `lab_invites` carries no client write policy, and
 * this is the one legitimate system-triggered writer besides
 * `inviteLabMemberAction` itself.
 */
export async function acceptPendingLabInvites(
  userId: string,
  email: string | null | undefined,
): Promise<number> {
  if (!userId || !email) return 0;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return 0;

  const admin = createAdminSupabase();
  const { data: invites, error } = await admin
    .from("lab_invites")
    .select("id, lab_id, role")
    .eq("email", normalized)
    .is("accepted_at", null);
  if (error || !invites || invites.length === 0) return 0;

  let accepted = 0;
  for (const invite of invites) {
    const { data: already } = await admin
      .from("lab_members")
      .select("user_id")
      .eq("lab_id", invite.lab_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (!already) {
      const { error: memberError } = await admin
        .from("lab_members")
        .insert({ lab_id: invite.lab_id, user_id: userId, role: invite.role });
      if (memberError) continue;
    }

    await admin
      .from("lab_invites")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", invite.id);

    await logAudit({
      labId: invite.lab_id, userId, action: "member.invite_accepted",
      entity: "lab_member", entityId: userId, detail: { email: normalized, role: invite.role },
    });
    accepted++;
  }
  return accepted;
}
