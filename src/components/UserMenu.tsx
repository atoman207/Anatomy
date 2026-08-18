"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";
import { createClient } from "@/lib/supabase/client";
import { signOutAction } from "@/lib/auth/actions";
import type { MeResponse } from "@/app/api/me/route";

const SIGNED_OUT: MeResponse = {
  signedIn: false, email: null, displayName: null,
  isPlatformAdmin: false, canAccessAdmin: false, labs: [],
};

/**
 * Session control in the navigation bar.
 *
 * Role facts come from `/api/me` because platform-admin status is decided from
 * server-only configuration. The Supabase auth listener re-fetches on sign-in
 * and sign-out so the menu never shows a stale identity.
 */
export function UserMenu() {
  const pathname = usePathname();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        const json = (await res.json()) as MeResponse;
        if (!cancelled) setMe(json);
      } catch {
        if (!cancelled) setMe(SIGNED_OUT);
      }
    }
    void load();

    // Supabase is optional; if it is not configured the client throws and the
    // menu simply stays in its signed-out state.
    let unsubscribe: (() => void) | undefined;
    try {
      const supabase = createClient();
      const { data } = supabase.auth.onAuthStateChange(() => {
        void load();
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch {
      // no-op
    }

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!me || !me.signedIn) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(pathname)}`}
        className="btn-hatme whitespace-nowrap rounded-md px-4 py-2 text-[15px] font-medium"
      >
        <span>ログイン</span>
      </Link>
    );
  }

  const initial = (me.displayName ?? me.email ?? "?").trim().charAt(0).toUpperCase();

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-xl border border-line px-2.5 py-1.5 text-sm text-ink transition-colors hover:bg-surface-2"
      >
        <span
          aria-hidden
          className="grid h-7 w-7 place-items-center rounded-lg bg-accent-soft text-xs font-semibold text-accent"
        >
          {initial}
        </span>
        <span className="hidden max-w-[10rem] truncate sm:inline">{me.displayName}</span>
        <span aria-hidden className="text-ink-3">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-surface-1 shadow-lg"
        >
          <div className="border-b border-line px-3 py-2.5">
            <p className="truncate text-sm font-medium text-ink">{me.displayName}</p>
            <p className="truncate text-[11px] text-ink-3">{me.email}</p>
            {me.isPlatformAdmin && (
              <p className="mt-1 inline-flex rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">
                システム管理者
              </p>
            )}
          </div>

          {me.labs.length > 0 && (
            <div className="border-b border-line px-3 py-2">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-ink-3">
                研究室
              </p>
              {me.labs.map((l) => (
                <p key={l.id} className="truncate text-[11px] text-ink-2">
                  {l.name} <span className="text-ink-3">({l.role})</span>
                </p>
              ))}
            </div>
          )}

          <nav className="flex flex-col py-1">
            <MenuLink href="/experiments" onClick={() => setOpen(false)}>
              実験一覧
            </MenuLink>
            {me.canAccessAdmin && (
              <MenuLink href="/admin" onClick={() => setOpen(false)}>
                管理
              </MenuLink>
            )}
            <MenuLink href="/admin/account" onClick={() => setOpen(false)}>
              アカウント
            </MenuLink>
          </nav>

          <div className="border-t border-line p-2">
            <button
              role="menuitem"
              disabled={pending}
              onClick={() => {
                setPending(true);
                void signOutAction();
              }}
              className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
            >
              {pending ? "…" : "ログアウト"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href, children, onClick,
}: {
  href: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className={cx(
        "px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}
