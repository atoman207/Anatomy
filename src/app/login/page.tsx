"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Callout, Card, Field, TextInput } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup" | "forgot";

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
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName || email.split("@")[0] },
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

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold text-ink">{heading}</h1>
        <p className="mt-1 text-sm text-ink-2">
          アカウントは実験の保存と管理画面へのアクセスにのみ必要です。
          データ整理・統計解析・実験ノートはログインなしでも利用できます。
        </p>
      </header>

      {signedOut && <Callout tone="good">ログアウトしました。</Callout>}
      {linkError && (
        <Callout tone="danger" title="リンクを処理できません">
          {linkError}
        </Callout>
      )}

      <Card>
        <form onSubmit={submit} className="flex flex-col gap-3">
          {mode === "signup" && (
            <Field label="表示名" htmlFor="name">
              <TextInput
                id="name" value={displayName} autoComplete="name"
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </Field>
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

          {error && <Callout tone="danger" title="続行できません">{error}</Callout>}
          {info && <Callout tone="good">{info}</Callout>}

          <Button type="submit" variant="primary" disabled={busy}>
            {busy
              ? "…"
              : mode === "signin"
                ? "ログイン"
                : mode === "signup"
                  ? "作成"
                  : "再設定リンクを送信"}
          </Button>
        </form>
      </Card>

      <div className="flex flex-col gap-1.5 text-center text-xs text-ink-2">
        {mode === "signin" && (
          <>
            <p>
              アカウントがない場合{" "}
              <button className="text-accent underline" onClick={() => switchTo("signup")}>
                作成する
              </button>
            </p>
            <p>
              <button className="text-accent underline" onClick={() => switchTo("forgot")}>
                パスワードを忘れた
              </button>
            </p>
          </>
        )}
        {mode !== "signin" && (
          <p>
            <button className="text-accent underline" onClick={() => switchTo("signin")}>
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
