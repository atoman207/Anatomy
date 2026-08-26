"use client";

import { useEffect, useMemo, useState } from "react";
import { TextInput, cx } from "@/components/ui";

type Status = "idle" | "checking" | "exists" | "missing";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteEmailInput({
  id,
  name = "email",
  defaultValue = "",
}: {
  id?: string;
  name?: string;
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [status, setStatus] = useState<Status>("idle");

  const normalized = useMemo(() => value.trim().toLowerCase(), [value]);
  const isValid = EMAIL_RE.test(normalized);

  useEffect(() => {
    if (!normalized) {
      setStatus("idle");
      return;
    }
    if (!isValid) {
      setStatus("idle");
      return;
    }

    const ctrl = new AbortController();
    setStatus("checking");
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/invitations/account-status?email=${encodeURIComponent(normalized)}`, {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (!res.ok) throw new Error("lookup failed");
        const json = (await res.json()) as { exists?: boolean };
        setStatus(json.exists ? "exists" : "missing");
      } catch {
        if (!ctrl.signal.aborted) setStatus("idle");
      }
    }, 250);

    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [normalized, isValid]);

  return (
    <div className="flex flex-col gap-1">
      <TextInput
        id={id}
        name={name}
        type="email"
        required
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={cx(
          status === "exists" && "border-good bg-good-soft/40 focus:border-good",
          status === "missing" && "border-danger/50 bg-danger-soft/40 focus:border-danger",
        )}
      />
      <p
        className={cx(
          "text-[11px] leading-snug text-ink-3",
          status === "exists" && "text-good",
          status === "missing" && "text-danger",
        )}
      >
        {status === "checking" && "アカウントを確認しています…"}
        {status === "exists" && "登録済みのアカウントです。追加するとすぐ研究室に参加できます。"}
        {status === "missing" && "未登録のメールアドレスです。招待メールを送信して登録後に参加します。"}
        {status === "idle" && " "}
      </p>
    </div>
  );
}
