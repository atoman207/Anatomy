"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Callout, Card, Field, TextInput } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

/**
 * Sets a new password after arriving from a recovery email.
 *
 * The callback route has already exchanged the link for a session, so this
 * page only has to confirm one exists and then update the password.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        if (!cancelled) setHasSession(Boolean(data.session));
      } catch {
        if (!cancelled) setHasSession(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (password.length < 8) throw new Error("パスワードは8文字以上にしてください。");
      if (password !== confirm) throw new Error("パスワードが一致しません。");
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      setTimeout(() => router.push("/experiments"), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "パスワードを設定できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold text-ink">
          パスワード再設定
        </h1>
      </header>

      {checking ? (
        <Card><p className="text-sm text-ink-3">リンクを確認中…</p></Card>
      ) : !hasSession ? (
        <Callout tone="warn" title="リンクが無効です">
          再設定リンクは有効期限があり、一度しか使用できません。{" "}
          <Link href="/login" className="underline">ログインページ</Link>
          から新しいリンクをリクエストしてください。
        </Callout>
      ) : done ? (
        <Callout tone="good" title="変更しました">
          実験一覧へ移動します…
        </Callout>
      ) : (
        <Card>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <Field label="新しいパスワード" htmlFor="p1" hint="8文字以上">
              <TextInput
                id="p1" type="password" required minLength={8} autoComplete="new-password"
                value={password} onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Field label="確認" htmlFor="p2">
              <TextInput
                id="p2" type="password" required minLength={8} autoComplete="new-password"
                value={confirm} onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
            {error && <Callout tone="danger" title="続行できません">{error}</Callout>}
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "…" : "設定"}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
