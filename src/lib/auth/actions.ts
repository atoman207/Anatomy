"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getSessionContext, logAudit } from "./guards";

/** Signs out and returns to the login page. */
export async function signOutAction(): Promise<void> {
  const ctx = await getSessionContext();
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();

  if (ctx) {
    await logAudit({
      labId: null,
      userId: ctx.user.id,
      action: "auth.sign_out",
      entity: "user",
      entityId: ctx.user.id,
    });
  }

  revalidatePath("/", "layout");
  redirect("/login?signedout=1");
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

/** Updates the signed-in user's display name in both auth metadata and profile. */
export async function updateDisplayNameAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const name = String(formData.get("display_name") ?? "").trim();
  if (name.length === 0) return { ok: false, message: "名前を入力してください。" };
  if (name.length > 80) return { ok: false, message: "名前が長すぎます（最大80文字）。" };

  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, message: "ログインしていません。" };

  const supabase = await createServerSupabase();
  const { error: authError } = await supabase.auth.updateUser({
    data: { display_name: name },
  });
  if (authError) return { ok: false, message: authError.message };

  // Keep the profiles row in step so member lists show the same name.
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ display_name: name })
    .eq("id", ctx.user.id);
  if (profileError) return { ok: false, message: profileError.message };

  await logAudit({
    labId: null,
    userId: ctx.user.id,
    action: "profile.rename",
    entity: "profile",
    entityId: ctx.user.id,
    detail: { display_name: name },
  });

  revalidatePath("/admin", "layout");
  return { ok: true, message: "表示名を更新しました。" };
}

/** Changes the signed-in user's password. */
export async function changePasswordAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    return { ok: false, message: "パスワードは8文字以上にしてください。" };
  }
  if (password !== confirm) {
    return { ok: false, message: "パスワードが一致しません。" };
  }

  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, message: "ログインしていません。" };

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, message: error.message };

  await logAudit({
    labId: null,
    userId: ctx.user.id,
    action: "auth.password_changed",
    entity: "user",
    entityId: ctx.user.id,
  });

  return { ok: true, message: "パスワードを変更しました。" };
}
