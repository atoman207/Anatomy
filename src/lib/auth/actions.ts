"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { AVATAR_MAX_DATA_URL_LENGTH } from "@/lib/auth/avatar";
import { japanPhone } from "@/lib/auth/profileFields";
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

/** Updates the signed-in user's profile (name, avatar, and optional contact fields). */
export async function updateProfileAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const name = String(formData.get("display_name") ?? "").trim();
  if (name.length === 0) return { ok: false, message: "名前を入力してください。" };
  if (name.length > 80) return { ok: false, message: "名前が長すぎます（最大80文字）。" };

  const dateOfBirth = optionalProfileString(formData.get("date_of_birth"));
  const major = optionalProfileString(formData.get("major"));
  const phoneNational = String(formData.get("phone_national") ?? "");
  const phoneNumber = japanPhone(phoneNational);

  const avatarRaw = String(formData.get("avatar_url") ?? "");
  const avatarUrl = avatarRaw.trim() === "" ? null : avatarRaw.trim();
  if (avatarUrl && avatarUrl.length > AVATAR_MAX_DATA_URL_LENGTH) {
    return { ok: false, message: "アバター画像が大きすぎます。別の画像をお試しください。" };
  }
  if (avatarUrl && avatarUrl.startsWith("data:") && !avatarUrl.startsWith("data:image/")) {
    return { ok: false, message: "アバターは画像ファイルのみ使用できます。" };
  }

  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, message: "ログインしていません。" };

  const supabase = await createServerSupabase();
  const { error: authError } = await supabase.auth.updateUser({
    data: { display_name: name },
  });
  if (authError) return { ok: false, message: authError.message };

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      display_name: name,
      avatar_url: avatarUrl,
      date_of_birth: dateOfBirth,
      phone_number: phoneNumber,
      major,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ctx.user.id);
  if (profileError) return { ok: false, message: profileError.message };

  await logAudit({
    labId: null,
    userId: ctx.user.id,
    action: "profile.update",
    entity: "profile",
    entityId: ctx.user.id,
    detail: {
      display_name: name,
      has_avatar: Boolean(avatarUrl),
      date_of_birth: dateOfBirth,
      phone_number: phoneNumber,
      major,
    },
  });

  revalidatePath("/account");
  revalidatePath("/admin", "layout");
  return { ok: true, message: "個人情報を更新しました。" };
}

/** @deprecated Use updateProfileAction — kept for any stale imports. */
export async function updateDisplayNameAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return updateProfileAction(_prev, formData);
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

function optionalProfileString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
