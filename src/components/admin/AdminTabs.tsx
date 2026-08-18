"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

interface Tab {
  href: string;
  label: string;
  /** Match the path exactly, so /admin does not stay active on every subpage. */
  exact?: boolean;
}

const LAB_TABS: Tab[] = [
  { href: "/admin", label: "概要", exact: true },
  { href: "/admin/members", label: "メンバー" },
  { href: "/admin/labs", label: "研究室" },
  { href: "/admin/audit", label: "監査ログ" },
  { href: "/admin/account", label: "アカウント" },
];

const PLATFORM_TABS: Tab[] = [
  { href: "/admin/users", label: "ユーザー" },
];

export function AdminTabs({ isPlatformAdmin }: { isPlatformAdmin: boolean }) {
  const pathname = usePathname();
  const tabs = isPlatformAdmin
    ? [...LAB_TABS.slice(0, 3), ...PLATFORM_TABS, ...LAB_TABS.slice(3)]
    : LAB_TABS;

  return (
    <nav className="scroll-x flex gap-1 border-b border-line" aria-label="管理メニュー">
      {tabs.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-accent text-accent"
                : "border-transparent text-ink-2 hover:text-ink",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
