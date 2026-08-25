"use server";

import { createAdminSupabase, getCurrentUser } from "@/lib/supabase/server";
import { sendMail } from "@/lib/email/smtp";

/**
 * The public /contact form - reachable without a session, like the landing
 * page it lives beside. Written through the service-role client rather than
 * the session-scoped one: `contact_messages` has RLS enabled with no
 * policies at all (see the migration), so an anonymous visitor's own
 * Supabase client could never insert here even if it tried.
 */

export interface ActionResult {
  ok: boolean;
  message: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MESSAGE_MAX = 2000;

export async function submitContactMessage(formData: FormData): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();

  if (!name) return { ok: false, message: "お名前を入力してください。" };
  if (!EMAIL_RE.test(email)) return { ok: false, message: "メールアドレスの形式が正しくありません。" };
  if (!message) return { ok: false, message: "お問い合わせ内容を入力してください。" };
  if (message.length > MESSAGE_MAX) {
    return { ok: false, message: `お問い合わせ内容は${MESSAGE_MAX}文字以内で入力してください。` };
  }

  const user = await getCurrentUser();

  const admin = createAdminSupabase();
  const { error } = await admin.from("contact_messages").insert({
    name,
    email,
    phone: phone || null,
    message,
    submitted_by: user?.id ?? null,
  });

  if (error) return { ok: false, message: "送信に失敗しました。時間をおいて再度お試しください。" };

  // Best-effort: the message is already durably recorded above, so a flaky
  // SMTP connection must not make an already-successful submission look
  // like it failed to the person who just sent it. Logged server-side so a
  // real delivery problem is still noticed operationally.
  const emailResult = await sendMail({
    subject: `【お問い合わせ】${name} 様より`,
    text: [
      `お名前: ${name}`,
      `メールアドレス: ${email}`,
      phone ? `電話番号: ${phone}` : null,
      "",
      "お問い合わせ内容:",
      message,
    ].filter((line) => line !== null).join("\n"),
    replyTo: email,
  });
  if (!emailResult.ok) {
    console.error("[contact] notification email failed:", emailResult.error);
  }

  return { ok: true, message: "お問い合わせを受け付けました。ご連絡ありがとうございます。" };
}
