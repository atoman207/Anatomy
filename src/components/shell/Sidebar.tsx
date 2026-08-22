"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cx } from "@/components/ui";
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
  const groups = visibleGroups(visibility).filter((group) => {
    // Platform admins never do lab work themselves, so only the 管理 section
    // (and account links) belong in their rail — on every page, not just
    // while inside /admin. Lab-level admins still do research day to day, so
    // they only lose the research tools while actually in the admin console.
    const restrictToAdmin = visibility.isPlatformAdmin || pathname.startsWith("/admin");
    if (!restrictToAdmin) return true;
    return group.id === "admin" || group.id === "personal";
  });

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
    </div>
  );
}
