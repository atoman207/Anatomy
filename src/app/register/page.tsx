"use client";

import { Suspense } from "react";
import { AuthForm } from "@/components/auth/AuthForm";
import { AuthPageShell } from "@/components/auth/AuthPageShell";

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <AuthPageShell>
          <div className="text-sm text-ink-3">…</div>
        </AuthPageShell>
      }
    >
      <AuthForm variant="register" />
    </Suspense>
  );
}
