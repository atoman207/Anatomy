"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { visibleGroups, type NavVisibility } from "./navigation";
import type { MeResponse } from "@/app/api/me/route";

/**
 * Primary navigation.
 *
 * Everything the user can reach lives here, so the header is free to carry
 * identity and alerts only. Groups collapse because an administrator sees
 * roughly twice as many entries as a member does, and a list that long is
 * harder to scan than one that folds.
 */
export function Sidebar({
  me, collapsed, onNavigate,
}: {
  me: MeResponse | null;
  collapsed: boolean;
  /** Called after a link is followed, so the mobile drawer can close. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [folded, setFolded] = useState<Record<string, boolean>>({});

  const visibility: NavVisibility = {
    signedIn: me?.signedIn ?? false,
    canAccessAdmin: me?.canAccessAdmin ?? false,
    isPlatformAdmin: me?.isPlatformAdmin ?? false,
  };
  const groups = visibleGroups(visibility);

  return (
    <div className="flex h-full flex-col bg-[var(--shell-bg)]">
      {/* Brand */}
      <div
        className={cx(
          "flex h-[var(--header-height)] shrink-0 items-center gap-2.5 border-b border-[var(--shell-border)]",
          collapsed ? "justify-center px-2" : "px-4",
        )}
      >
        <Image
          src="/LOGO.png"
          alt=""
          width={34}
          height={34}
          className="h-[34px] w-[34px] shrink-0 rounded-lg object-contain"
          priority
        />
        {!collapsed && (
          <p className="truncate text-[13px] font-semibold leading-tight text-[var(--shell-text)]">
            研究データ管理
          </p>
        )}
      </div>

      {/* Navigation */}
      <nav className="shell-scroll flex-1 overflow-y-auto px-2 py-3" aria-label="メインナビゲーション">
        {groups.map((group) => {
          const isFolded = folded[group.id] ?? false;
          return (
            <div key={group.id} className="mb-1">
              {group.label && !collapsed && (
                <button
                  onClick={() => setFolded((f) => ({ ...f, [group.id]: !isFolded }))}
                  aria-expanded={!isFolded}
                  className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--shell-text-faint)] transition-colors hover:text-[var(--shell-text-dim)]"
                >
                  <span>{group.label}</span>
                  <svg
                    viewBox="0 0 24 24" aria-hidden
                    className={cx("h-3 w-3 transition-transform", isFolded && "-rotate-90")}
                    fill="none" stroke="currentColor" strokeWidth={2.5}
                    strokeLinecap="round" strokeLinejoin="round"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              )}
              {group.label && collapsed && (
                <div className="mx-2 my-2 border-t border-[var(--shell-border)]" />
              )}

              {!isFolded && (
                <ul className="flex flex-col gap-0.5">
                  {group.items.map((item) => {
                    const active = item.exact
                      ? pathname === item.href
                      : pathname === item.href || pathname.startsWith(`${item.href}/`);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={onNavigate}
                          aria-current={active ? "page" : undefined}
                          title={collapsed ? item.label : undefined}
                          className={cx(
                            "group relative flex items-center gap-2.5 rounded-lg py-2 text-[13px] transition-colors",
                            collapsed ? "justify-center px-2" : "px-2.5",
                            active
                              ? "bg-[var(--shell-active-bg)] font-medium text-[var(--shell-active-text)]"
                              : "text-[var(--shell-text-dim)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]",
                          )}
                        >
                          {/* The active bar makes the current page findable
                              at a glance without relying on colour alone. */}
                          {active && (
                            <span
                              aria-hidden
                              className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-[var(--shell-accent)]"
                            />
                          )}
                          {item.icon}
                          {!collapsed && <span className="truncate">{item.label}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      <AccountBlock me={me} collapsed={collapsed} onNavigate={onNavigate} />
    </div>
  );
}

/**
 * Who you are, at the foot of the sidebar.
 *
 * Placed here rather than only in the header because role is context you need
 * while working — "am I an admin of this lab?" is the question behind half the
 * navigation choices above it.
 */
function AccountBlock({
  me, collapsed, onNavigate,
}: {
  me: MeResponse | null;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  if (!me || !me.signedIn) {
    return (
      <div className={cx("shrink-0 border-t border-[var(--shell-border)] p-3", collapsed && "px-2")}>
        <Link
          href="/login"
          onClick={onNavigate}
          className={cx(
            "flex items-center justify-center gap-2 rounded-lg bg-[var(--shell-accent)] py-2 text-[13px] font-medium text-[#08210f] transition-opacity hover:opacity-90",
            collapsed ? "px-1" : "px-3",
          )}
        >
          {collapsed ? <Icon name="login" className="h-4 w-4" /> : (
            <>
              <Icon name="login" className="h-4 w-4" />
              ログイン
            </>
          )}
        </Link>
      </div>
    );
  }

  const initial = (me.displayName ?? me.email ?? "?").trim().charAt(0).toUpperCase();
  const primaryLab = me.labs[0];

  if (collapsed) {
    return (
      <div className="shrink-0 border-t border-[var(--shell-border)] p-2">
        <Link
          href="/admin/account"
          onClick={onNavigate}
          title={`${me.displayName} (${me.email})`}
          className="mx-auto grid h-9 w-9 place-items-center overflow-hidden rounded-lg bg-[var(--shell-hover)] text-xs font-semibold text-[var(--shell-active-text)]"
        >
          {me.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- avatar sources are arbitrary user uploads, not app assets next/image can optimise
            <img src={me.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            initial
          )}
        </Link>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-[var(--shell-border)] p-3">
      <Link
        href="/admin/account"
        onClick={onNavigate}
        className="flex items-center gap-2.5 rounded-lg p-2 transition-colors hover:bg-[var(--shell-hover)]"
      >
        {me.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- avatar sources are arbitrary user uploads, not app assets next/image can optimise
          <img
            src={me.avatarUrl}
            alt=""
            className="h-9 w-9 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--shell-active-bg)] text-sm font-semibold text-[var(--shell-active-text)]"
          >
            {initial}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-[var(--shell-text)]">
            {me.displayName}
          </span>
          <span className="block truncate text-[10px] text-[var(--shell-text-faint)]">
            {me.email}
          </span>
        </span>
      </Link>

      <div className="mt-2 flex flex-col gap-1 px-2">
        {me.isPlatformAdmin && (
          <span className="inline-flex w-fit items-center rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--shell-active-text)] ring-1 ring-inset ring-[var(--shell-active-text)]/30">
            システム管理者
          </span>
        )}
        {primaryLab && (
          <span className="truncate text-[10px] text-[var(--shell-text-faint)]">
            {primaryLab.name}
            <span className="ml-1 text-[var(--shell-text-faint)]">({roleJa(primaryLab.role)})</span>
            {me.labs.length > 1 && ` +${me.labs.length - 1}`}
          </span>
        )}
      </div>
    </div>
  );
}

function roleJa(role: string): string {
  return (
    { owner: "オーナー", admin: "管理者", member: "メンバー", viewer: "閲覧者" }[role] ?? role
  );
}
