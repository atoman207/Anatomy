"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Callout, Card, Field, TextInput } from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
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
  const [done, setDone] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (!cancelled) setHasSession(Boolean(data.user));
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
    try {
      if (password.length < 8) throw new Error("パスワードは8文字以上にしてください。");
      if (password !== confirm) throw new Error("パスワードが一致しません。");
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast("パスワードを変更しました。", { tone: "good" });
      setDone(true);
      setTimeout(() => router.push("/experiments"), 1500);
    } catch (e) {
      toast(e instanceof Error ? e.message : "パスワードを設定できませんでした。", { tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[480px] flex-col gap-6 py-4">
      <header>
        <h1 className="font-serif text-2xl font-semibold text-ink">パスワード再設定</h1>
      </header>

      {checking ? (
        <Card className="border-t-[3px] border-t-accent shadow-[var(--shadow-md)]">
          <p className="text-[15px] text-ink-3">リンクを確認中…</p>
        </Card>
      ) : !hasSession ? (
        <Callout tone="warn" title="リンクが無効です">
          再設定リンクは有効期限があり、一度しか使用できません。{" "}
          <Link href="/login" className="font-medium text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent">
            ログインページ
          </Link>
          から新しいリンクをリクエストしてください。
        </Callout>
      ) : done ? (
        <Card className="border-t-[3px] border-t-accent shadow-[var(--shadow-md)]">
          <p className="text-[15px] text-ink-3">実験一覧へ移動します…</p>
        </Card>
      ) : (
        <Card className="animate-fade-in-up animate-delay-1 border-t-[3px] border-t-accent shadow-[var(--shadow-md)]">
          <form onSubmit={submit} className="flex flex-col gap-5">
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
            <Button type="submit" variant="primary" disabled={busy} icon="lock" className="mt-1 w-full">
              {busy ? "…" : "設定する"}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
