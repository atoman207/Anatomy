"use server";

import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/server";
import {
  assertCanManageLab, assertIsLabOwner, getSessionContext, logAudit,
} from "@/lib/auth/guards";
import { LAB_ROLES, LAB_ROLE_LABELS, PLATFORM_ROLES, PLATFORM_ROLE_LABELS } from "@/lib/auth/roles";
import { sendMail } from "@/lib/email/smtp";
import { labHasPaymentHistory } from "@/lib/billing/paymentHistory";
import type { LabRole, PlatformRole } from "@/lib/supabase/types";

export interface ActionResult {
  ok: boolean;
  message: string;
}

const fail = (message: string): ActionResult => ({ ok: false, message });
const done = (message: string): ActionResult => ({ ok: true, message });

/**
 * Every action below re-reads the caller's session and re-checks the role
 * against the database. The lab id arrives from the browser, so it is treated
 * as a request, never as proof of authority.
 */
async function ctxOrThrow() {
  const ctx = await getSessionContext();
  if (!ctx) throw new Error("サインインしていません。");
  return ctx;
}

function parsePlatformRole(value: FormDataEntryValue | null): PlatformRole | null {
  const s = String(value ?? "");
  return (PLATFORM_ROLES as string[]).includes(s) ? (s as PlatformRole) : null;
}

function parseRole(value: FormDataEntryValue | null): LabRole | null {
  const s = String(value ?? "");
  return (LAB_ROLES as string[]).includes(s) ? (s as LabRole) : null;
}

function normalizeEmail(value: FormDataEntryValue | null): string {
  return String(value ?? "").trim().toLowerCase();
}

function siteOrigin(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "";
}

function invitedSignupPath(email: string): string {
  const params = new URLSearchParams({
    invite: "1",
    email,
    next: "/labs",
  });
  return `/register?${params.toString()}`;
}

/** Finds an auth user by email, paging until found. */
async function findUserByEmail(email: string) {
  const admin = createAdminSupabase();
  let page = 1;
  // listUsers is paginated; a lab-scale deployment will not exceed a few pages.
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

/* ------------------------------------------------------------------ */
/* Laboratory membership                                               */
/* ------------------------------------------------------------------ */

export async function addMemberAction(
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
      return fail("オーナー権限は譲渡でのみ付与できます。「譲渡」を使用してください。");
    }
    await assertCanManageLab(ctx, labId);

    const admin = createAdminSupabase();
    const existing = await findUserByEmail(email);

    if (!existing) {
      // No account yet: keep a pending invite so creating an account from the
      // emailed sign-up link can immediately attach the new user to the lab.
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

      const site = siteOrigin();
      const signupUrl = site ? `${site}${invitedSignupPath(email)}` : "";
      const emailResult = await sendMail({
        to: email,
        subject: "研究室への招待が届いています",
        text: [
          "研究室へ招待されました。",
          "",
          "以下のリンクからアカウントを作成してください。",
          signupUrl || "サイトURLが未設定のため、管理者にお問い合わせください。",
          "",
          "登録が完了すると、招待された研究室に自動的に参加します。",
        ].join("\n"),
      });
      if (!emailResult.ok) {
        return fail(
          `${email} 宛の招待は保存しましたが、招待メールを送信できませんでした: ${emailResult.error}。` +
            "SMTP設定を確認してください。登録が完了すれば研究室には自動追加されます。",
        );
      }
      await logAudit({
        labId, userId: ctx.user.id, action: "member.invited",
        entity: "lab_member", detail: { email, role },
      });
      return done(
        `${email} に招待メールを送信しました。登録が完了すると自動的に研究室へ追加されます。`,
      );
    }

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

    revalidatePath("/admin/members");
    const roleJa = LAB_ROLE_LABELS[role].ja;
    return done(`${email} を${roleJa}として追加しました。`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "メンバーを追加できませんでした。");
  }
}

export async function changeMemberRoleAction(
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

    // The owner row is the laboratory's anchor: demoting it would leave the
    // lab with no one able to delete or transfer it.
    if (target.role === "owner") {
      return fail("オーナーの役割はここでは変更できません。譲渡を使用してください。");
    }
    if (role === "owner") {
      return fail("オーナーにするには「譲渡」を使用してください。");
    }
    if (userId === ctx.user.id && !ctx.isPlatformAdmin) {
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

    revalidatePath("/admin/members");
    return done(`権限を${LAB_ROLE_LABELS[role].ja}に変更しました。`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "役割を変更できませんでした。");
  }
}

export async function removeMemberAction(
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

    revalidatePath("/admin/members");
    return done("メンバーを削除しました。データは研究室に残ります。");
  } catch (e) {
    return fail(e instanceof Error ? e.message : "メンバーを削除できませんでした。");
  }
}

export async function transferOwnershipAction(
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

    // Promote first, then demote: if the second write fails the lab still has
    // an owner, which is the safer failure.
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

    revalidatePath("/admin", "layout");
    return done("オーナーを変更しました。あなたは管理者になりました。");
  } catch (e) {
    return fail(e instanceof Error ? e.message : "オーナー権限を譲渡できませんでした。");
  }
}

/* ------------------------------------------------------------------ */
/* Laboratory settings                                                 */
/* ------------------------------------------------------------------ */

export async function createLabAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow();
    // Laboratory creation is an administrator function. The page is already
    // gated, but a server action is a public endpoint: without this check a
    // signed-in User could still POST to it directly.
    if (!ctx.isPlatformAdmin) return fail("システム管理者のみ利用できます。");

    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || null;
    if (!name) return fail("研究室名を入力してください。");
    if (name.length > 120) return fail("名称が長すぎます（最大120文字）。");

    const admin = createAdminSupabase();
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

    revalidatePath("/admin", "layout");
    return done(`研究室「${name}」を作成しました。`);
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

    revalidatePath("/admin", "layout");
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

    // Typing the name is the confirmation: this cascades to every experiment,
    // dataset, figure and notebook entry in the laboratory.
    if (confirm !== lab.name) {
      return fail(`削除を確認するため、研究室名「${lab.name}」を正確に入力してください。`);
    }

    const payment = await labHasPaymentHistory(labId);
    if (payment) {
      return fail(
        `研究室「${lab.name}」には決済履歴があるため削除できません（${payment}）。` +
          "決済のない無料の研究室のみ削除できます。",
      );
    }

    const counts = await countLabContents(labId);
    const { error } = await admin.from("laboratories").delete().eq("id", labId);
    if (error) return fail(error.message);

    await logAudit({
      labId: null, userId: ctx.user.id, action: "lab.deleted",
      entity: "laboratory", entityId: labId,
      detail: { name: lab.name, deleted: counts },
    });

    revalidatePath("/admin", "layout");
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
/* Platform administration                                             */
/* ------------------------------------------------------------------ */

export async function createUserAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow();
    if (!ctx.isPlatformAdmin) return fail("システム管理者のみ利用できます。");

    const email = normalizeEmail(formData.get("email"));
    const password = String(formData.get("password") ?? "");
    const displayName = String(formData.get("display_name") ?? "").trim();

    if (!email.includes("@")) return fail("有効なメールアドレスを入力してください。");
    if (password.length < 8) return fail("パスワードは8文字以上にしてください。");

    const admin = createAdminSupabase();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      // Confirmed immediately: this is a deliberate act by an administrator,
      // and a fresh project's built-in mailer is heavily rate-limited.
      email_confirm: true,
      user_metadata: { display_name: displayName || email.split("@")[0] },
    });
    if (error) return fail(error.message);

    await logAudit({
      labId: null, userId: ctx.user.id, action: "user.created",
      entity: "user", entityId: data.user?.id ?? null, detail: { email },
    });

    revalidatePath("/admin/users");
    return done(`${email} を作成しました（確認済み）。`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "ユーザーを作成できませんでした。");
  }
}

export async function confirmUserAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow();
    if (!ctx.isPlatformAdmin) return fail("システム管理者のみ利用できます。");
    const userId = String(formData.get("user_id") ?? "");
    if (!userId) return fail("ユーザーが選択されていません。");

    const admin = createAdminSupabase();
    const { error } = await admin.auth.admin.updateUserById(userId, {
      email_confirm: true,
    });
    if (error) return fail(error.message);

    await logAudit({
      labId: null, userId: ctx.user.id, action: "user.confirmed",
      entity: "user", entityId: userId,
    });

    revalidatePath("/admin/users");
    return done("メールを確認済みにしました。");
  } catch (e) {
    return fail(e instanceof Error ? e.message : "ユーザーを確認済みにできませんでした。");
  }
}

export async function sendPasswordResetAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow();
    if (!ctx.isPlatformAdmin) return fail("システム管理者のみ利用できます。");
    const email = normalizeEmail(formData.get("email"));
    if (!email.includes("@")) return fail("有効なメールアドレスを入力してください。");

    const admin = createAdminSupabase();
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
    const { error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: site ? { redirectTo: `${site}/auth/callback?next=/auth/reset` } : undefined,
    });
    if (error) return fail(error.message);

    await logAudit({
      labId: null, userId: ctx.user.id, action: "user.password_reset_sent",
      entity: "user", detail: { email },
    });

    return done(`${email} にパスワード再設定リンクを送信しました。`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "再設定リンクを送信できませんでした。");
  }
}

export async function deleteUserAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow();
    if (!ctx.isPlatformAdmin) return fail("システム管理者のみ利用できます。");
    const userId = String(formData.get("user_id") ?? "");
    const confirm = normalizeEmail(formData.get("confirm"));
    if (!userId) return fail("ユーザーが選択されていません。");

    if (userId === ctx.user.id) {
      return fail("ここから自分自身のアカウントは削除できません。");
    }

    const admin = createAdminSupabase();
    const { data: target, error: readError } = await admin.auth.admin.getUserById(userId);
    if (readError) return fail(readError.message);
    const email = (target.user?.email ?? "").toLowerCase();

    if (confirm !== email) {
      return fail(`削除を確認するため、メールアドレス（${email}）を入力してください。`);
    }

    const payment = await findUserPaymentHistory(userId);
    if (payment) {
      return fail(
        `${email} には決済履歴があるため削除できません（${payment}）。` +
          "決済のあるアカウントは削除できません。",
      );
    }

    // laboratories.owner_id is ON DELETE RESTRICT, so owned labs must go first.
    // Experiments and related rows cascade from laboratory deletion.
    const { data: ownedLabs, error: ownedError } = await admin
      .from("laboratories")
      .select("id, name")
      .eq("owner_id", userId);
    if (ownedError) return fail(ownedError.message);

    const deletedLabs: { id: string; name: string; contents: Record<string, number> }[] = [];
    for (const lab of ownedLabs ?? []) {
      const contents = await countLabContents(lab.id);
      const { error: labDeleteError } = await admin
        .from("laboratories")
        .delete()
        .eq("id", lab.id);
      if (labDeleteError) {
        return fail(
          `研究室「${lab.name}」を削除できませんでした: ${labDeleteError.message}`,
        );
      }
      deletedLabs.push({ id: lab.id, name: lab.name, contents });
    }

    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return fail(error.message);

    await logAudit({
      labId: null,
      userId: ctx.user.id,
      action: "user.deleted",
      entity: "user",
      entityId: userId,
      detail: {
        email,
        deleted_labs: deletedLabs.map((l) => ({
          id: l.id,
          name: l.name,
          ...l.contents,
        })),
      },
    });

    revalidatePath("/admin/users");
    revalidatePath("/admin/labs");
    revalidatePath("/admin", "layout");

    const labNote =
      deletedLabs.length > 0
        ? `（所有研究室 ${deletedLabs.length} 件と関連データを削除）`
        : "";
    return done(`${email} を削除しました${labNote}。`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "ユーザーを削除できませんでした。");
  }
}

/**
 * Any real Stripe subscription on a lab the user owns, or any purchased
 * AI査読 credits for the user. Mock / complimentary grants do not count.
 */
async function findUserPaymentHistory(userId: string): Promise<string | null> {
  const admin = createAdminSupabase();

  const { data: credits } = await admin
    .from("peer_review_credits")
    .select("total_purchased")
    .eq("user_id", userId)
    .maybeSingle();
  if ((credits?.total_purchased ?? 0) > 0) {
    return `AI査読クレジット購入 ${credits!.total_purchased} 回分`;
  }

  const { data: ownedLabs } = await admin
    .from("laboratories")
    .select("id, name")
    .eq("owner_id", userId);
  const labs = ownedLabs ?? [];
  if (labs.length === 0) return null;

  for (const lab of labs) {
    const reason = await labHasPaymentHistory(lab.id);
    if (reason) {
      return `研究室「${lab.name}」: ${reason}`;
    }
  }

  return null;
}

/**
 * Promotes an account to Administrator, or demotes it back to User.
 *
 * Written with the service-role client because `profiles.platform_role` is
 * deliberately unreachable from any browser session - the trigger in
 * migration 0002 rejects the write otherwise. That is the whole point: the
 * role can only change through this path, which re-checks the caller first.
 *
 * An administrator may not demote themselves. Not a courtesy: the last
 * administrator demoting themselves would leave the deployment with no way to
 * promote anyone, recoverable only by editing the database by hand.
 */
export async function setPlatformRoleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await ctxOrThrow();
    if (!ctx.isPlatformAdmin) return fail("システム管理者のみ利用できます。");

    const userId = String(formData.get("user_id") ?? "");
    const role = parsePlatformRole(formData.get("platform_role"));
    if (!userId) return fail("ユーザーが指定されていません。");
    if (!role) return fail("権限の指定が不正です。");
    if (userId === ctx.user.id && role !== "admin") {
      return fail("自分自身の管理者権限は解除できません。");
    }

    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("profiles")
      .update({ platform_role: role })
      .eq("id", userId)
      .select("email")
      .maybeSingle();
    if (error) return fail(error.message);
    if (!data) return fail("ユーザーが見つかりません。");

    await logAudit({
      labId: null, userId: ctx.user.id, action: "user.platform_role_changed",
      entity: "user", entityId: userId, detail: { email: data.email, role },
    });

    revalidatePath("/admin/users");
    revalidatePath("/admin", "layout");
    return done(`${data.email} を「${PLATFORM_ROLE_LABELS[role].ja}」にしました。`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "権限を変更できませんでした。");
  }
}
