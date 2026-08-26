"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { signOutAction } from "@/lib/auth/actions";
import { useWorkspace } from "@/components/workspace";
import { titleForPath } from "./navigation";
import { subscribeTheme, getTheme, getThemeServer, toggleTheme } from "./themePreference";
import {
  subscribeNotifications,
  getClientNotices,
  getClientNoticesServer,
  getReadIds,
  getReadIdsServer,
  mergeNotices,
  countUnread,
  markNoticesRead,
} from "./notificationStore";
import type { MeResponse } from "@/app/api/me/route";
import type { NotificationsResponse, Notice } from "@/app/api/notifications/route";
import type { TodayEntry, TodayResponse } from "@/app/api/notebook/today/route";

/**
 * Top bar: where you are, what needs attention, and who you are.
 *
 * No navigation links — those all live in the sidebar. Duplicating them here
 * would give every destination two homes and neither would feel authoritative.
 */
export function Header({
  me, notifications, today, onToggleSidebar, sidebarCollapsed,
}: {
  me: MeResponse | null;
  notifications: NotificationsResponse | null;
  today: TodayResponse | null;
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const title = titleForPath(pathname, searchParams.toString());
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");

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

      {me?.signedIn && !isAdmin && <TodayLogButton entries={today?.entries ?? null} />}
      <ThemeToggle />
      <NotificationBell notifications={notifications} />
      <UserButton me={me} />
    </header>
  );
}

/**
 * "今日の実験記録" when nothing has been logged today, or "今日の実験記録を見る"
 * (with a dropdown if there is more than one) once something has. `entries`
 * being `null` means the fetch has not resolved yet - the create button is
 * shown in that case too, since it is always a safe action (it never hides a
 * record; at worst a researcher who already logged today sees the button for
 * a moment before the "見る" version replaces it).
 */
function TodayLogButton({ entries }: { entries: TodayEntry[] | null }) {
  const router = useRouter();
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function openEntry(entry: TodayEntry) {
    ws.setExperiment({
      experimentId: entry.experimentId,
      labId: entry.labId,
      label: `${entry.experimentName}（${entry.labName}）`,
    });
    ws.setWizardStep(4);
    router.push("/record?step=4");
    setOpen(false);
  }

  if (!entries || entries.length === 0) {
    return (
      <Link
        href="/record?step=1"
        className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-[var(--shell-accent)] px-3 py-1.5 text-[13px] font-medium text-[#08210f] transition-opacity hover:opacity-90 sm:inline-flex"
      >
        <Icon name="notebook" className="h-3.5 w-3.5" />
        今日の実験記録
      </Link>
    );
  }

  if (entries.length === 1) {
    return (
      <button
        onClick={() => openEntry(entries[0])}
        className="hidden shrink-0 items-center gap-1.5 rounded-lg border border-[var(--shell-border)] px-3 py-1.5 text-[13px] font-medium text-[var(--shell-text-dim)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] sm:inline-flex"
      >
        <Icon name="check" className="h-3.5 w-3.5" />
        今日の実験記録を見る
      </button>
    );
  }

  return (
    <div ref={ref} className="relative hidden shrink-0 sm:block">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--shell-border)] px-3 py-1.5 text-[13px] font-medium text-[var(--shell-text-dim)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]"
      >
        <Icon name="check" className="h-3.5 w-3.5" />
        今日の実験記録を見る（{entries.length}）
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-72 overflow-hidden rounded-xl border border-[var(--shell-border)] bg-[var(--shell-bg-raised)] shadow-xl"
        >
          <ul className="max-h-80 overflow-y-auto">
            {entries.map((e) => (
              <li key={e.id} className="border-b border-[var(--shell-border)] last:border-0">
                <button
                  role="menuitem"
                  onClick={() => openEntry(e)}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--shell-hover)]"
                >
                  <span className="truncate text-[12px] font-medium text-[var(--shell-text)]">{e.title}</span>
                  <span className="truncate text-[10px] text-[var(--shell-text-faint)]">
                    {e.experimentName} ・ {e.labName}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
      className="grid h-9 w-9 place-items-center rounded-lg text-[var(--shell-text-dim)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]"
    >
      <Icon name={dark ? "moon" : "sun"} className="h-5 w-5" />
    </button>
  );
}

function NotificationBell({ notifications }: { notifications: NotificationsResponse | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const clientNotices = useSyncExternalStore(
    subscribeNotifications,
    getClientNotices,
    getClientNoticesServer,
  );
  const readIds = useSyncExternalStore(
    subscribeNotifications,
    getReadIds,
    getReadIdsServer,
  );

  const notices = mergeNotices(notifications?.notices ?? [], clientNotices);
  const unread = countUnread(notices, readIds);

  const close = () => {
    // Closing the panel counts as reading everything currently listed, so the
    // red badge clears after the user has had a chance to see the items.
    markNoticesRead(notices.map((n) => n.id));
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // close closes over the current notice ids; re-bind when the list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, notices]);

  const toggleOpen = () => {
    if (open) close();
    else setOpen(true);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggleOpen}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={unread > 0 ? `通知 未読 ${unread} 件` : "通知"}
        className="relative grid h-9 w-9 place-items-center rounded-lg text-[var(--shell-text-dim)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]"
      >
        <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--danger)] px-1 text-[9px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
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
            {unread > 0 ? (
              <span
                aria-label={`未読 ${unread} 件`}
                className="grid h-5 min-w-5 place-items-center rounded-full bg-[var(--danger)] px-1.5 text-[10px] font-bold text-white"
              >
                {unread > 9 ? "9+" : unread}
              </span>
            ) : (
              <span className="text-[11px] text-[var(--shell-text-faint)]">{notices.length} 件</span>
            )}
          </div>
          <div className="shell-scroll max-h-96 overflow-y-auto">
            {notices.length === 0 ? (
              <p className="px-3 py-8 text-center text-[12px] text-[var(--shell-text-faint)]">
                新しい通知はありません
              </p>
            ) : (
              <ul>
                {notices.map((n) => (
                  <NoticeRow
                    key={n.id}
                    notice={n}
                    unread={!readIds.has(n.id)}
                    onNavigate={close}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NoticeRow({
  notice, unread, onNavigate,
}: {
  notice: Notice;
  unread: boolean;
  onNavigate: () => void;
}) {
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
        <span className={cx(
          "block text-[12px] text-[var(--shell-text)]",
          unread ? "font-semibold" : "font-medium",
        )}>
          {notice.title}
        </span>
        {notice.detail && (
          <span className="block text-[11px] text-[var(--shell-text-dim)]">{notice.detail}</span>
        )}
        {notice.at && (
          <span className="mt-0.5 block text-[10px] text-[var(--shell-text-faint)]">
            {new Date(notice.at).toLocaleString("ja-JP")}
          </span>
        )}
      </span>
    </>
  );

  return (
    <li className={cx(
      "border-b border-[var(--shell-border)] last:border-0",
      unread && "bg-[var(--shell-hover)]/40",
    )}>
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
              href="/account"
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
