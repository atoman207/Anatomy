"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui";
import { signOutAction } from "@/lib/auth/actions";

export function SignOutButton({ size = "sm" }: { size?: "sm" | "md" }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size={size}
      variant="secondary"
      disabled={pending}
      onClick={() => start(() => void signOutAction())}
    >
      {pending ? "…" : "ログアウト"}
    </Button>
  );
}
