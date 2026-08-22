import { NextResponse } from "next/server";
import { createAdminSupabase, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RegisterBody {
  email?: unknown;
  password?: unknown;
  display_name?: unknown;
  date_of_birth?: unknown;
  phone_number?: unknown;
  major?: unknown;
  avatar_url?: unknown;
}

/**
 * Creates a confirmed account without sending a confirmation email.
 *
 * Confirmation links need a PKCE verifier that only exists in the browser that
 * started sign-up. Skipping the mailer avoids that dead-end; the user then
 * logs in with email and password.
 */
export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "登録は現在利用できません。" }, { status: 503 });
  }

  let body: RegisterBody;
  try {
    body = (await request.json()) as RegisterBody;
  } catch {
    return NextResponse.json({ error: "入力を読み取れませんでした。" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const displayName = String(body.display_name ?? "").trim() || email.split("@")[0];
  const dateOfBirth = optionalString(body.date_of_birth);
  const phoneNumber = optionalString(body.phone_number);
  const major = optionalString(body.major);
  const avatarUrl = optionalString(body.avatar_url);

  if (!email.includes("@")) {
    return NextResponse.json({ error: "有効なメールアドレスを入力してください。" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "パスワードは8文字以上にしてください。" }, { status: 400 });
  }

  try {
    const admin = createAdminSupabase();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: displayName,
        date_of_birth: dateOfBirth,
        phone_number: phoneNumber,
        major,
      },
    });
    if (error) {
      return NextResponse.json({ error: friendlyAuthError(error.message) }, { status: 400 });
    }

    const userId = data.user?.id;
    if (userId) {
      await admin.from("profiles").update({
        display_name: displayName,
        date_of_birth: dateOfBirth,
        phone_number: phoneNumber,
        major,
        avatar_url: avatarUrl,
      }).eq("id", userId);

      // Ordinary users should not have to create a laboratory before they can
      // save experiments or notes - give them a personal workspace immediately.
      const { ensurePersonalLab } = await import("@/lib/labs/personalLab");
      await ensurePersonalLab(userId, displayName);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "アカウントを作成できませんでした。" },
      { status: 500 },
    );
  }
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function friendlyAuthError(message: string): string {
  if (/already registered|already been registered|exists/i.test(message)) {
    return "このメールアドレスはすでに登録されています。";
  }
  return message;
}
