"use client";

import { Suspense, useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Field, TextInput, cx } from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import { Icon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

type Mode = "signin" | "signup" | "forgot";

const AVATAR_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const AVATAR_MAX_DIMENSION = 256;
const JP_DIAL = "+81";

/** Downscales an arbitrary image file to a small square-ish JPEG data URL. */
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

/** Builds +81… from a national number typed without the country code. */
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

/** Drops oversized fields (e.g. avatar data URLs) from the JWT so cookies stay small. */
async function stripBloatedAuthMetadata(supabase: SupabaseClient): Promise<void> {
  const { data } = await supabase.auth.getUser();
  const meta = data.user?.user_metadata;
  if (!meta || typeof meta !== "object") return;
  const avatar = meta.avatar_url;
  if (typeof avatar !== "string") return;
  if (avatar.length < 200 && !avatar.startsWith("data:")) return;
  await supabase.auth.updateUser({ data: { avatar_url: "" } });
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-md text-sm text-ink-3">…</div>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();

  // Only same-site paths are honoured, so a crafted ?next= cannot bounce a
  // freshly signed-in user to another host.
  const rawNext = params.get("next");
  const next =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";

  const [mode, setMode] = useState<Mode>("signin");
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

  // These reflect a redirect that already happened (logout, signup, a bad
  // email link) rather than something this component just did, so they are
  // reported once, on arrival, instead of at the moment they were set.
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    if (signedOut) toast("ログアウトしました。", { tone: "good" });
    if (registered) toast("アカウントを作成しました。メールとパスワードでログインしてください。", { tone: "good" });
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
        setMode("signin");
        router.replace(`/login?registered=1&email=${encodeURIComponent(email)}`);
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await stripBloatedAuthMetadata(supabase);

      router.push(next);
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
        ? "アカウント作成"
        : "パスワードを忘れた";

  const submitLabel =
    mode === "signin" ? "ログイン" : mode === "signup" ? "作成する" : "再設定リンクを送信";

  return (
    <div className="mx-auto flex w-full max-w-[480px] flex-col gap-6 py-4">
      <header>
        <h1 className="font-serif text-2xl font-semibold text-ink">{heading}</h1>
      </header>

      <Card className="border-t-[3px] border-t-accent">
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
      </Card>

      <div className="flex flex-col gap-2 text-center text-[14px] text-ink-2">
        {mode === "signin" && (
          <>
            <p>
              アカウントがない場合{" "}
              <button
                className="font-medium text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
                onClick={() => switchTo("signup")}
              >
                作成する
              </button>
            </p>
            <p>
              <button
                className="font-medium text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
                onClick={() => switchTo("forgot")}
              >
                パスワードを忘れた
              </button>
            </p>
          </>
        )}
        {mode !== "signin" && (
          <p>
            <button
              className="font-medium text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
              onClick={() => switchTo("signin")}
            >
              ログインに戻る
            </button>
          </p>
        )}
      </div>
    </div>
  );

  function switchTo(m: Mode) {
    setMode(m);
  }
}

function friendlyLinkError(raw: string): string {
  if (/PKCE|code verifier|verification code|invalid_link/i.test(raw)) {
    return "このリンクは使えません。メールとパスワードでログインしてください。";
  }
  return raw;
}

function PasswordInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <TextInput
        {...rest}
        type={visible ? "text" : "password"}
        className={cx("pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "パスワードを隠す" : "パスワードを表示"}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-ink-3 hover:text-ink"
      >
        <Icon name={visible ? "eyeOff" : "eye"} className="h-4 w-4" />
      </button>
    </div>
  );
}
