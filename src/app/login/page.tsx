"use client";

import { Suspense, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Callout, Card, Field, TextInput } from "@/components/ui";
import { Icon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup" | "forgot";

const AVATAR_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const AVATAR_MAX_DIMENSION = 256;

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
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/experiments";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [major, setMajor] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onAvatarSelected(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("画像ファイルを選択してください。");
      return;
    }
    if (file.size > AVATAR_MAX_SOURCE_BYTES) {
      setError("画像サイズが大きすぎます（8MB以下にしてください）。");
      return;
    }
    try {
      setAvatarPreview(await resizeAvatarToDataUrl(file));
      setError(null);
    } catch {
      setError("画像を処理できませんでした。");
    }
  }

  const linkError = params.get("error");
  const signedOut = params.get("signedout");

  function siteOrigin(): string {
    if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
    return typeof window !== "undefined" ? window.location.origin : "";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const supabase = createClient();

      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${siteOrigin()}/auth/callback?next=/auth/reset`,
        });
        if (error) throw error;
        setInfo(
          "再設定リンクを送信しました。そのメールアドレスにアカウントが存在する場合、再設定用リンクが届きます。",
        );
        setMode("signin");
        return;
      }

      if (mode === "signup") {
        if (password !== confirmPassword) {
          throw new Error("パスワードが一致しません。");
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: displayName || email.split("@")[0],
              avatar_url: avatarPreview,
              date_of_birth: dateOfBirth || null,
              phone_number: phoneNumber || null,
              major: major || null,
            },
            emailRedirectTo: `${siteOrigin()}/auth/callback?next=${encodeURIComponent(next)}`,
          },
        });
        if (error) throw error;
        // With email confirmation on there is no session until the link is
        // clicked, so say so rather than silently doing nothing.
        if (!data.session) {
          setInfo(
            "確認メールを送信しました。メール内の確認リンクを開いてからログインしてください。",
          );
          setMode("signin");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }

      router.push(next);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "認証に失敗しました。");
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

      {signedOut && <Callout tone="good">ログアウトしました。</Callout>}
      {linkError && (
        <Callout tone="danger" title="リンクを処理できません">
          {linkError}
        </Callout>
      )}

      <Card className="border-t-[3px] border-t-accent">
        <form onSubmit={submit} className="flex flex-col gap-5">
          {mode === "signup" && (
            <>
              <Field label="アバター画像（任意）">
                <div className="flex items-center gap-3">
                  <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full border border-line bg-surface-2 text-ink-3">
                    {avatarPreview ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local preview of a not-yet-uploaded file, not an app asset
                      <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Icon name="user" className="h-6 w-6" />
                    )}
                  </div>
                  <Button type="button" size="sm" icon="upload" onClick={() => avatarInput.current?.click()}>
                    画像を選択
                  </Button>
                  {avatarPreview && (
                    <Button type="button" variant="ghost" size="sm" icon="trash" onClick={() => setAvatarPreview(null)}>
                      削除
                    </Button>
                  )}
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
                  <TextInput
                    id="phone" type="tel" autoComplete="tel"
                    value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)}
                  />
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
              <TextInput
                id="password" type="password" required minLength={mode === "signup" ? 8 : undefined}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password} onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          )}

          {mode === "signup" && (
            <Field label="パスワード確認" htmlFor="confirm-password">
              <TextInput
                id="confirm-password" type="password" required minLength={8}
                autoComplete="new-password"
                value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </Field>
          )}

          {error && <Callout tone="danger" title="続行できません">{error}</Callout>}
          {info && <Callout tone="good">{info}</Callout>}

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
    setError(null);
    setInfo(null);
  }
}
