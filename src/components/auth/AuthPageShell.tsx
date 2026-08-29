import type { ReactNode } from "react";

/** Shared bg7 backdrop and centered column used by login and register. */
export function AuthPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate min-h-dvh w-full overflow-hidden">
      <div className="login-backdrop" aria-hidden />
      <div className="relative z-10 flex min-h-dvh w-full items-center justify-center px-4 py-10">
        {children}
      </div>
    </div>
  );
}
