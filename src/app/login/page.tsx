"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Callout, Card, Field, TextInput } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const supabase = createClient();
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName || email.split("@")[0] } },
        });
        if (error) throw error;
        // With email confirmation on, there is no session until the link is clicked.
        if (!data.session) {
          setInfo("Account created. Check your email for the confirmation link, then sign in.");
          setMode("signin");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      router.push("/experiments");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold text-ink">
          {mode === "signin" ? "ログイン / Sign in" : "アカウント作成 / Create account"}
        </h1>
        <p className="mt-1 text-sm text-ink-2">
          An account is only needed to save experiments. The analysis tools work without one.
        </p>
      </header>

      <Card>
        <form onSubmit={submit} className="flex flex-col gap-3">
          {mode === "signup" && (
            <Field label="表示名 / Display name" htmlFor="name">
              <TextInput
                id="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
              />
            </Field>
          )}
          <Field label="メール / Email" htmlFor="email">
            <TextInput
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </Field>
          <Field
            label="パスワード / Password"
            htmlFor="password"
            hint={mode === "signup" ? "At least 8 characters." : undefined}
          >
            <TextInput
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </Field>

          {error && <Callout tone="danger" title="Could not continue">{error}</Callout>}
          {info && <Callout tone="good">{info}</Callout>}

          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "…" : mode === "signin" ? "ログイン / Sign in" : "作成 / Create account"}
          </Button>
        </form>
      </Card>

      <p className="text-center text-xs text-ink-2">
        {mode === "signin" ? "アカウントがない場合 / No account?" : "既にお持ちの場合 / Already have one?"}{" "}
        <button
          className="text-accent underline"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setInfo(null);
          }}
        >
          {mode === "signin" ? "作成する / Create one" : "ログイン / Sign in"}
        </button>
      </p>
    </div>
  );
}
