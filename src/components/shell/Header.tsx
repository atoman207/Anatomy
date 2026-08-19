"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { signOutAction } from "@/lib/auth/actions";
import { titleForPath } from "./navigation";
import { subscribeTheme, getTheme, getThemeServer, toggleTheme } from "./themePreference";
import type { MeResponse } from "@/app/api/me/route";
import type { NotificationsResponse, Notice } from "@/app/api/notifications/route";

/**
 * Top bar: where you are, what needs attention, and who you are.
 *
 * No navigation links — those all live in the sidebar. Duplicating them here
 * would give every destination two homes and neither would feel authoritative.
 */
export function Header({
  me, notifications, onToggleSidebar, sidebarCollapsed,
}: {
  me: MeResponse | null;
  notifications: NotificationsResponse | null;
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
}) {
  const pathname = usePathname();
  const title = titleForPath(pathname);

  return (
    <header className="sticky top-0 z-30 flex h-[var(--header-height)] shrink-0 items-center gap-3 border-b border-[var(--shell-border)] bg-[var(--shell-bg-raised)] px-3 sm:px-4">
      <button
        onClick={onToggleSidebar}
        aria-label={sidebarCollapsed ? "サイドバーを開く" : "サイドバーを閉じる"}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[var(--shell-text-dim)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]"
      >
        <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Not an h1: the page content owns that landmark, and two would
          leave screen-reader users with an ambiguous document outline. */}
      <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[var(--shell-text)]">
        {title}
      </p>

      <ThemeToggle />
      <NotificationBell notifications={notifications} />
      <UserButton me={me} />
    </header>
  );
}

/**
 * Flips the whole app between light and dark surfaces.
 *
 * The icon shows the current mode (sun on white, moon on black), matching the
 * control people already know from other consoles.
 */
function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getThemeServer);
  const dark = theme === "dark";

  return (
    <button
      onClick={toggleTheme}
      aria-pressed={dark}
      aria-label={dark ? "ライト表示に切り替え" : "ダーク表示に切り替え"}
      title={dark ? "ライト表示に切り替え" : "ダーク表示に切り替え"}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[var(--shell-text-dim)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]"
    >
      <Icon name={dark ? "moon" : "sun"} className="h-5 w-5" />
    </button>
  );
}

function NotificationBell({ notifications }: { notifications: NotificationsResponse | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const notices = notifications?.notices ?? [];
  // Only genuine problems raise the badge; informational items sit quietly in
  // the list. A count that includes everything trains people to ignore it.
  const urgent = notices.filter((n) => n.tone === "warn" || n.tone === "danger").length;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={urgent > 0 ? `通知 ${urgent} 件の要対応` : "通知"}
        className="relative grid h-9 w-9 place-items-center rounded-lg text-[var(--shell-text-dim)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]"
      >
        <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {urgent > 0 && (
          <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--danger)] px-1 text-[9px] font-bold text-white">
            {urgent > 9 ? "9+" : urgent}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border border-[var(--shell-border)] bg-[var(--shell-bg-raised)] shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-[var(--shell-border)] px-3 py-2.5">
            <p className="text-[13px] font-semibold text-[var(--shell-text)]">通知</p>
            <span className="text-[11px] text-[var(--shell-text-faint)]">{notices.length} 件</span>
          </div>
          <div className="shell-scroll max-h-96 overflow-y-auto">
            {notices.length === 0 ? (
              <p className="px-3 py-8 text-center text-[12px] text-[var(--shell-text-faint)]">
                新しい通知はありません
              </p>
            ) : (
              <ul>
                {notices.map((n) => (
                  <NoticeRow key={n.id} notice={n} onNavigate={() => setOpen(false)} />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NoticeRow({ notice, onNavigate }: { notice: Notice; onNavigate: () => void }) {
  const tone = {
    info: { dot: "bg-[var(--shell-text-faint)]", label: "情報" },
    good: { dot: "bg-[var(--shell-accent)]", label: "完了" },
    warn: { dot: "bg-[var(--warn)]", label: "要対応" },
    danger: { dot: "bg-[var(--danger)]", label: "重要" },
  }[notice.tone];

  const inner = (
    <>
      <span aria-hidden className={cx("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)} />
      <span className="min-w-0 flex-1">
        <span className="sr-only">{tone.label}: </span>
        <span className="block text-[12px] font-medium text-[var(--shell-text)]">{notice.title}</span>
        <span className="block text-[11px] text-[var(--shell-text-dim)]">{notice.detail}</span>
        {notice.at && (
          <span className="mt-0.5 block text-[10px] text-[var(--shell-text-faint)]">
            {new Date(notice.at).toLocaleString("ja-JP")}
          </span>
        )}
      </span>
    </>
  );

  return (
    <li className="border-b border-[var(--shell-border)] last:border-0">
      {notice.href ? (
        <Link
          href={notice.href}
          onClick={onNavigate}
          className="flex gap-2.5 px-3 py-2.5 transition-colors hover:bg-[var(--shell-hover)]"
        >
          {inner}
        </Link>
      ) : (
        <div className="flex gap-2.5 px-3 py-2.5">{inner}</div>
      )}
    </li>
  );
}

function UserButton({ me }: { me: MeResponse | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!me || !me.signedIn) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(pathname)}`}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--shell-accent)] px-3.5 py-1.5 text-[13px] font-medium text-[#08210f] transition-opacity hover:opacity-90"
      >
        <Icon name="login" className="h-3.5 w-3.5" />
        ログイン
      </Link>
    );
  }

  const initial = (me.displayName ?? me.email ?? "?").trim().charAt(0).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition-colors hover:bg-[var(--shell-hover)]"
      >
        {me.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- avatar sources are arbitrary user uploads, not app assets next/image can optimise
          <img
            src={me.avatarUrl}
            alt=""
            className="h-8 w-8 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--shell-active-bg)] text-[13px] font-semibold text-[var(--shell-active-text)]"
          >
            {initial}
          </span>
        )}
        <span className="hidden max-w-[9rem] truncate text-[13px] text-[var(--shell-text)] sm:block">
          {me.displayName}
        </span>
        <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5 text-[var(--shell-text-faint)]" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-xl border border-[var(--shell-border)] bg-[var(--shell-bg-raised)] shadow-xl"
        >
          <div className="border-b border-[var(--shell-border)] px-3 py-2.5">
            <p className="truncate text-[13px] font-medium text-[var(--shell-text)]">{me.displayName}</p>
            <p className="truncate text-[11px] text-[var(--shell-text-faint)]">{me.email}</p>
            {me.isPlatformAdmin && (
              <span className="mt-1.5 inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--shell-active-text)] ring-1 ring-inset ring-[var(--shell-active-text)]/30">
                システム管理者
              </span>
            )}
          </div>

          {me.labs.length > 0 && (
            <div className="border-b border-[var(--shell-border)] px-3 py-2">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--shell-text-faint)]">
                所属研究室
              </p>
              {me.labs.map((l) => (
                <p key={l.id} className="truncate text-[11px] text-[var(--shell-text-dim)]">
                  {l.name}
                </p>
              ))}
            </div>
          )}

          <nav className="flex flex-col py-1">
            <Link
              href="/admin/account"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="px-3 py-2 text-[13px] text-[var(--shell-text-dim)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]"
            >
              アカウント設定
            </Link>
            {me.canAccessAdmin && (
              <Link
                href="/admin"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="px-3 py-2 text-[13px] text-[var(--shell-text-dim)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]"
              >
                管理画面
              </Link>
            )}
          </nav>

          <div className="border-t border-[var(--shell-border)] p-2">
            <button
              role="menuitem"
              disabled={pending}
              onClick={() => {
                setPending(true);
                void signOutAction();
              }}
              className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-[var(--shell-text-dim)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] disabled:opacity-50"
            >
              <Icon name="logout" className="h-3.5 w-3.5" />
              {pending ? "…" : "ログアウト"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
