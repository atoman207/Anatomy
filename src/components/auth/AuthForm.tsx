"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Field, TextInput } from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import { Icon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import type { MeResponse } from "@/app/api/me/route";
import { postLoginPathForSession } from "@/lib/auth/postLogin";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthPageShell } from "./AuthPageShell";
import { PasswordInput } from "@/components/PasswordInput";

type Mode = "signin" | "signup" | "forgot";

const AVATAR_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const AVATAR_MAX_DIMENSION = 256;
const JP_DIAL = "+81";

async function resizeAvatarToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, AVATAR_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("画像を処理できませんでした。");
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    bitmap.close();
  }
}

function japanPhone(national: string): string | null {
  const raw = national.trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (raw.startsWith("+")) return `+${digits}`;
  const rest = digits.startsWith("0")
    ? digits.slice(1)
    : digits.startsWith("81")
      ? digits.slice(2)
      : digits;
  return rest ? `${JP_DIAL}${rest}` : null;
}

async function stripBloatedAuthMetadata(supabase: SupabaseClient): Promise<void> {
  const { data } = await supabase.auth.getUser();
  const meta = data.user?.user_metadata;
  if (!meta || typeof meta !== "object") return;
  const avatar = meta.avatar_url;
  if (typeof avatar !== "string") return;
  if (avatar.length < 200 && !avatar.startsWith("data:")) return;
  await supabase.auth.updateUser({ data: { avatar_url: "" } });
}

function friendlyLinkError(raw: string): string {
  if (/PKCE|code verifier|verification code|invalid_link/i.test(raw)) {
    return "このリンクは使えません。メールとパスワードでログインしてください。";
  }
  return raw;
}

function registerHrefFromParams(params: URLSearchParams): string {
  const q = new URLSearchParams(params.toString());
  q.delete("mode");
  const s = q.toString();
  return s ? `/register?${s}` : "/register";
}

function loginHrefFromParams(params: URLSearchParams): string {
  const q = new URLSearchParams(params.toString());
  q.delete("mode");
  const s = q.toString();
  return s ? `/login?${s}` : "/login";
}

export function AuthForm({ variant }: { variant: "login" | "register" }) {
  const router = useRouter();
  const params = useSearchParams();

  const rawNext = params.get("next");
  const next =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";
  const invite = params.get("invite") === "1";
  const requestedMode = params.get("mode");
  const initialMode: Mode =
    variant === "register"
      ? "signup"
      : requestedMode === "forgot"
        ? "forgot"
        : "signin";

  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [major, setMajor] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (variant === "login" && requestedMode === "signup") {
      router.replace(registerHrefFromParams(params));
    }
  }, [variant, requestedMode, params, router]);

  async function onAvatarSelected(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("画像ファイルを選択してください。", { tone: "danger" });
      return;
    }
    if (file.size > AVATAR_MAX_SOURCE_BYTES) {
      toast("画像サイズが大きすぎます（8MB以下にしてください）。", { tone: "danger" });
      return;
    }
    try {
      setAvatarPreview(await resizeAvatarToDataUrl(file));
    } catch {
      toast("画像を処理できませんでした。", { tone: "danger" });
    }
  }

  const linkError = params.get("error");
  const signedOut = params.get("signedout");
  const registered = params.get("registered");

  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    if (signedOut) toast("ログアウトしました。", { tone: "good" });
    if (registered) {
      toast(
        invite
          ? "アカウントを作成しました。ログインすると招待された研究室に参加できます。"
          : "アカウントを作成しました。まずは無料プランでご利用いただけます。AI機能のすべてを使う場合は「料金・支払い」から個人研究者プラン以上をお選びください。",
        { tone: "good" },
      );
    }
    if (linkError) toast(friendlyLinkError(linkError), { tone: "danger", title: "リンクを処理できません" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function siteOrigin(): string {
    if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
    return typeof window !== "undefined" ? window.location.origin : "";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const supabase = createClient();

      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${siteOrigin()}/auth/callback?next=/auth/reset`,
        });
        if (error) throw error;
        toast(
          "再設定リンクを送信しました。そのメールアドレスにアカウントが存在する場合、再設定用リンクが届きます。",
          { tone: "good" },
        );
        setMode("signin");
        return;
      }

      if (mode === "signup") {
        if (password !== confirmPassword) {
          throw new Error("パスワードが一致しません。");
        }
        const phone = japanPhone(phoneNumber);
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            display_name: displayName || email.split("@")[0],
            date_of_birth: dateOfBirth || null,
            phone_number: phone,
            major: major.trim() || null,
            avatar_url: avatarPreview,
          }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "アカウントを作成できませんでした。");

        setPassword("");
        setConfirmPassword("");
        const nextAfterSignup = invite ? next : "/billing";
        const inviteFlag = invite ? "&invite=1" : "";
        router.replace(
          `/login?registered=1&email=${encodeURIComponent(email)}&next=${encodeURIComponent(nextAfterSignup)}${inviteFlag}`,
        );
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await stripBloatedAuthMetadata(supabase);

      const meRes = await fetch("/api/me", { cache: "no-store" });
      const canAccessAdmin = meRes.ok
        ? ((await meRes.json()) as MeResponse).canAccessAdmin
        : false;

      router.push(postLoginPathForSession(rawNext, canAccessAdmin));
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "認証に失敗しました。", { tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  const heading =
    mode === "signin"
      ? "ログイン"
      : mode === "signup"
        ? "個人研究者として登録"
        : "パスワードを忘れた";

  const submitLabel =
    mode === "signin" ? "ログイン" : mode === "signup" ? "アカウントを作成" : "再設定リンクを送信";

  const registerHref = registerHrefFromParams(params);
  const loginHref = loginHrefFromParams(params);

  return (
    <AuthPageShell>
      <div className="flex w-[min(100%,480px)] flex-col">
        <Card className="border-t-[3px] border-t-accent bg-white shadow-[0_18px_50px_-28px_rgba(26,54,93,0.35)]">
          <header className="mb-5 text-center">
            <h1 className="font-serif text-2xl font-semibold text-ink">{heading}</h1>
            {mode === "signup" && (
              <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
                {invite
                  ? "招待された研究室に参加するためのアカウントを作成します。登録後にログインすると、自動的に研究室へ追加されます。"
                  : "まずは無料プラン（研究室1・メンバー2・実験3）で始められます。登録後、必要に応じて「料金・支払い」から個人研究者プラン以上へアップグレードしてください。"}
              </p>
            )}
          </header>

          <form onSubmit={submit} className="flex flex-col gap-5">
            {mode === "signup" && (
              <>
                <Field label="アバター画像（任意）">
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => avatarInput.current?.click()}
                      aria-label="アバター画像を選択"
                      className="grid h-24 w-24 place-items-center overflow-hidden rounded-full border border-line bg-surface-2 text-ink-3 transition-colors hover:border-accent hover:text-accent"
                    >
                      {avatarPreview ? (
                        // eslint-disable-next-line @next/next/no-img-element -- local preview of a not-yet-uploaded file, not an app asset
                        <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Icon name="user" className="h-10 w-10" />
                      )}
                    </button>
                  </div>
                  <input
                    ref={avatarInput}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      void onAvatarSelected(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </Field>

                <Field label="表示名" htmlFor="name">
                  <TextInput
                    id="name" value={displayName} autoComplete="name"
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </Field>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="生年月日（任意）" htmlFor="dob">
                    <TextInput
                      id="dob" type="date" autoComplete="bday"
                      value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)}
                    />
                  </Field>
                  <Field label="電話番号（任意）" htmlFor="phone">
                    <div className="flex">
                      <span className="inline-flex items-center rounded-l-md border border-r-0 border-line bg-surface-2 px-3 text-[15px] text-ink-2">
                        {JP_DIAL}
                      </span>
                      <TextInput
                        id="phone"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel-national"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        className="rounded-l-none"
                        placeholder="90-1234-5678"
                      />
                    </div>
                  </Field>
                </div>

                <Field label="専攻（任意）" htmlFor="major">
                  <TextInput
                    id="major" value={major}
                    onChange={(e) => setMajor(e.target.value)}
                  />
                </Field>
              </>
            )}

            <Field label="メール" htmlFor="email">
              <TextInput
                id="email" type="email" required autoComplete="email"
                value={email} onChange={(e) => setEmail(e.target.value)}
              />
            </Field>

            {mode !== "forgot" && (
              <Field
                label="パスワード"
                htmlFor="password"
                hint={mode === "signup" ? "8文字以上" : undefined}
              >
                <PasswordInput
                  id="password"
                  required
                  minLength={mode === "signup" ? 8 : undefined}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
            )}

            {mode === "signup" && (
              <Field label="パスワード確認" htmlFor="confirm-password">
                <PasswordInput
                  id="confirm-password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </Field>
            )}

            <Button
              type="submit"
              variant="primary"
              disabled={busy}
              icon={mode === "signin" ? "login" : mode === "signup" ? "plus" : "mail"}
              className="mt-1 w-full"
            >
              {busy ? "…" : submitLabel}
            </Button>
          </form>

          <div className="mt-5 flex flex-col gap-2 border-t border-line pt-5 text-center text-[14px] text-ink-2">
            {variant === "login" && mode === "signin" && (
              <>
                <p>
                  アカウントがない場合{" "}
                  <Link
                    href={registerHref}
                    className="font-medium text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
                  >
                    作成する
                  </Link>
                </p>
                <p>
                  <button
                    type="button"
                    className="font-medium text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
                    onClick={() => setMode("forgot")}
                  >
                    パスワードを忘れた
                  </button>
                </p>
              </>
            )}
            {variant === "login" && mode === "forgot" && (
              <p>
                <button
                  type="button"
                  className="font-medium text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
                  onClick={() => setMode("signin")}
                >
                  ログインに戻る
                </button>
              </p>
            )}
            {variant === "register" && (
              <p className="font-semibold text-ink">
                すでにアカウントをお持ちの場合{" "}
                <Link
                  href={loginHref}
                  className="font-bold text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
                >
                  ログイン
                </Link>
              </p>
            )}
          </div>
        </Card>
      </div>
    </AuthPageShell>
  );
}
