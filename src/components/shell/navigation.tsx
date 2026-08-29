import type { ReactNode } from "react";
import { cx } from "@/components/ui";

/**
 * One definition of the navigation, used by the sidebar and the mobile drawer.
 *
 * Admin entries live in the same tree rather than in a separate console: an
 * administrator managing members is doing lab work, not visiting a different
 * product, and a second navigation would mean a second place to get lost.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** Match the path exactly, so a parent does not stay active on children. */
  exact?: boolean;
  /** Only shown to users who can administer something. */
  adminOnly?: boolean;
  /** Only shown to platform administrators. */
  platformOnly?: boolean;
  /** Only shown when signed in. */
  authOnly?: boolean;
  /**
   * Hidden from platform administrators.
   *
   * For the self-service pages an administrator has an administrative
   * equivalent of: they manage every laboratory's plan at
   * `/admin/subscriptions`, so the personal 料金・支払い page would only be a
   * second, narrower way to do the same thing - and the one that acts on
   * whichever laboratory happened to be selected.
   */
  hideForPlatformAdmin?: boolean;
}

export interface NavGroup {
  id: string;
  label: string | null;
  items: NavItem[];
  adminOnly?: boolean;
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function NavIcon({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span
      className={cx(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
        tone,
      )}
    >
      <svg viewBox="0 0 24 24" aria-hidden className="h-[17px] w-[17px]" {...stroke}>
        {children}
      </svg>
    </span>
  );
}

const icons = {
  dashboard: (
    <NavIcon tone="bg-blue-100 text-blue-600">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </NavIcon>
  ),
  labs: (
    <NavIcon tone="bg-indigo-100 text-indigo-600">
      <path d="M3 21V9l9-6 9 6v12" />
      <path d="M3 21h18M9 21v-6h6v6" />
      <path d="M10 12h4" />
    </NavIcon>
  ),
  chat: (
    <NavIcon tone="bg-sky-100 text-sky-600">
      <path d="M5 5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-3.5 3a.5.5 0 0 1-.8-.4V14" />
      <circle cx="9" cy="9.5" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="12" cy="9.5" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="15" cy="9.5" r="0.75" fill="currentColor" stroke="none" />
    </NavIcon>
  ),
  experimentPick: (
    <NavIcon tone="bg-violet-100 text-violet-600">
      <path d="M9 4h8a2 2 0 0 1 2 2v14H7V6a2 2 0 0 1 2-2z" />
      <path d="M9 2v4h8" />
      <path d="M9 11h6M9 15h4" />
      <path d="m10 8 1.5 1.5L14 7" />
    </NavIcon>
  ),
  reagents: (
    <NavIcon tone="bg-emerald-100 text-emerald-600">
      <path d="M10 2h4" />
      <path d="M11 2v7l-4.5 9.5a2 2 0 0 0 1.8 2.9h7.6a2 2 0 0 0 1.8-2.9L13 9V2" />
      <path d="M8.5 16h7" />
      <circle cx="10" cy="13" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="14" cy="14.5" r="0.6" fill="currentColor" stroke="none" />
    </NavIcon>
  ),
  templateLayout: (
    <NavIcon tone="bg-amber-100 text-amber-700">
      <rect x="4" y="4" width="7" height="5" rx="1" />
      <rect x="13" y="4" width="7" height="5" rx="1" />
      <rect x="4" y="11" width="16" height="9" rx="1" />
      <path d="M7 14h10M7 17h6" />
    </NavIcon>
  ),
  notebookOpen: (
    <NavIcon tone="bg-cyan-100 text-cyan-700">
      <path d="M4 6a2 2 0 0 1 2-2h11a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2z" />
      <path d="M8 6v14" />
      <path d="M12 9h5M12 12h5M12 15h3" />
      <path d="M6.5 9.5v3.5l1.5-1 1.5 1V9.5" />
    </NavIcon>
  ),
  literatureSearch: (
    <NavIcon tone="bg-rose-100 text-rose-600">
      <path d="M6 3h8l4 4v12H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v4h4" />
      <circle cx="14.5" cy="14.5" r="3.5" />
      <path d="m17.5 17.5 3 3" />
    </NavIcon>
  ),
  organize: (
    <NavIcon tone="bg-teal-100 text-teal-700">
      <path d="M3 8a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M3 12h18" />
      <path d="M8 16h4" />
    </NavIcon>
  ),
  analyze: (
    <NavIcon tone="bg-orange-100 text-orange-600">
      <path d="M4 20V11M10 20V6M16 20v-8M22 20H2" />
      <path d="M16 8l3-2" />
    </NavIcon>
  ),
  peerReview: (
    <NavIcon tone="bg-purple-100 text-purple-600">
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
      <path d="m9 14.5 2 2 4.5-4.5" />
      <circle cx="17" cy="7" r="2.5" />
      <path d="M16 7h2M17 6v2" />
    </NavIcon>
  ),
  calculator: (
    <NavIcon tone="bg-slate-100 text-slate-600">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M8 6h8" />
      <path d="M8 11h1.5M12 11h1.5M16 11h1.5M8 15h1.5M12 15h1.5M16 15h1.5M8 19h1.5M12 19h1.5M16 19h1.5" />
    </NavIcon>
  ),
  experiments: (
    <NavIcon tone="bg-violet-100 text-violet-600">
      <path d="M9 2h6" />
      <path d="M10 2v7L5 18a2 2 0 0 0 1.8 2.8h10.4a2 2 0 0 0 1.8-2.8L14 9V2" />
      <path d="M7.5 15h9" />
    </NavIcon>
  ),
  adminHome: (
    <NavIcon tone="bg-indigo-100 text-indigo-700">
      <path d="M12 3 4 7v5c0 4.4 3.2 8.3 8 9 4.8-.7 8-4.6 8-9V7z" />
      <path d="M9 12l2 2 4-4" />
    </NavIcon>
  ),
  members: (
    <NavIcon tone="bg-blue-100 text-blue-600">
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 5a3 3 0 0 1 0 5.2" />
      <path d="M18 20a6 6 0 0 0-2.2-4.2" />
    </NavIcon>
  ),
  adminLabs: (
    <NavIcon tone="bg-indigo-100 text-indigo-600">
      <path d="M2 20V9l10-6 10 6v11" />
      <path d="M2 20h20M8 20v-5h8v5" />
    </NavIcon>
  ),
  users: (
    <NavIcon tone="bg-slate-100 text-slate-700">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
      <path d="M16 4h4v4" />
      <path d="M18 2v6" />
    </NavIcon>
  ),
  templates: (
    <NavIcon tone="bg-amber-100 text-amber-700">
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M9 3v18" />
      <path d="M12 8h5M12 12h5M12 16h3" />
    </NavIcon>
  ),
  content: (
    <NavIcon tone="bg-cyan-100 text-cyan-700">
      <ellipse cx="12" cy="5.5" rx="8" ry="2.5" />
      <path d="M4 5.5V12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V5.5" />
      <path d="M4 12v6.5c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V12" />
    </NavIcon>
  ),
  audit: (
    <NavIcon tone="bg-stone-100 text-stone-600">
      <path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
      <path d="M8 13h8M8 17h5" />
      <path d="M8 13l2 2 2-2" />
    </NavIcon>
  ),
  reviewers: (
    <NavIcon tone="bg-fuchsia-100 text-fuchsia-600">
      <circle cx="8" cy="9" r="2.5" />
      <circle cx="16" cy="9" r="2.5" />
      <path d="M4 19a4 4 0 0 1 8 0M12 19a4 4 0 0 1 8 0" />
      <path d="M12 3v3" />
    </NavIcon>
  ),
  megaphone: (
    <NavIcon tone="bg-orange-100 text-orange-600">
      <path d="M3 11v2a2 2 0 0 0 2 2h1l2 6h2l-1.5-6H11l7 4V5l-7 4H5a2 2 0 0 0-2 2z" />
      <path d="M18 9.5a3.5 3.5 0 0 1 0 5" />
    </NavIcon>
  ),
  billing: (
    <NavIcon tone="bg-green-100 text-green-700">
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M2.5 10h19" />
      <path d="M6 15h4" />
    </NavIcon>
  ),
  contracts: (
    <NavIcon tone="bg-emerald-100 text-emerald-700">
      <path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
      <path d="m9 13 1.5 1.5L13 11" />
    </NavIcon>
  ),
  account: (
    <NavIcon tone="bg-blue-100 text-blue-600">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
      <circle cx="17" cy="7" r="2" />
      <path d="M16.5 6.5h1v1" />
    </NavIcon>
  ),
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "work",
    label: null,
    items: [
      { href: "/dashboard", label: "ダッシュボード", icon: icons.dashboard, exact: true },
      { href: "/labs", label: "研究室", icon: icons.labs, authOnly: true },
      { href: "/chat", label: "チャット", icon: icons.chat, authOnly: true },
    ],
  },
  {
    id: "record",
    label: "記録",
    items: [
      { href: "/record?step=1", label: "実験選択", icon: icons.experimentPick },
      { href: "/record?step=2", label: "試薬・Lot", icon: icons.reagents },
      { href: "/record?step=3", label: "テンプレート", icon: icons.templateLayout },
      { href: "/record?step=4", label: "実験ノート", icon: icons.notebookOpen },
      { href: "/record?step=5", label: "論文検索", icon: icons.literatureSearch },
    ],
  },
  {
    id: "data",
    label: "データ",
    items: [
      { href: "/organize", label: "データ整理", icon: icons.organize },
      { href: "/analyze", label: "統計・図", icon: icons.analyze },
    ],
  },
  {
    id: "peer-review",
    label: "AI査読",
    items: [
      { href: "/peer-review", label: "AI査読", icon: icons.peerReview },
    ],
  },
  {
    id: "tools",
    label: "ツール",
    items: [
      { href: "/calculator", label: "計算ツール", icon: icons.calculator },
    ],
  },
  {
    id: "admin",
    label: "管理",
    adminOnly: true,
    items: [
      { href: "/admin", label: "管理者ダッシュボード", icon: icons.adminHome, exact: true, adminOnly: true },
      { href: "/admin/members", label: "メンバー", icon: icons.members, adminOnly: true },
      { href: "/admin/labs", label: "研究室", icon: icons.adminLabs, adminOnly: true },
      { href: "/admin/experiments", label: "実験", icon: icons.experiments, adminOnly: true },
      { href: "/admin/templates", label: "テンプレート", icon: icons.templates, adminOnly: true },
      { href: "/admin/users", label: "ユーザー", icon: icons.users, platformOnly: true },
      { href: "/admin/peer-review", label: "AI査読者", icon: icons.reviewers, platformOnly: true },
      { href: "/admin/news", label: "お知らせ", icon: icons.megaphone, platformOnly: true },
      { href: "/admin/content", label: "コンテンツ管理", icon: icons.content, platformOnly: true },
      { href: "/admin/billing", label: "決済", icon: icons.billing, exact: true, platformOnly: true },
      { href: "/admin/subscriptions", label: "契約管理", icon: icons.contracts, platformOnly: true },
      { href: "/admin/audit", label: "監査ログ", icon: icons.audit, adminOnly: true },
    ],
  },
  {
    id: "personal",
    label: "設定",
    items: [
      {
        href: "/billing", label: "料金・支払い", icon: icons.billing,
        authOnly: true, hideForPlatformAdmin: true,
      },
      { href: "/account", label: "アカウント設定", icon: icons.account, authOnly: true },
    ],
  },
];

export interface NavVisibility {
  signedIn: boolean;
  canAccessAdmin: boolean;
  isPlatformAdmin: boolean;
}

/** Filters the tree down to what this viewer may actually reach. */
export function visibleGroups(v: NavVisibility): NavGroup[] {
  return NAV_GROUPS.map((group) => {
    if (group.adminOnly && !v.canAccessAdmin) return null;
    const items = group.items.filter((item) => {
      if (item.platformOnly && !v.isPlatformAdmin) return false;
      if (item.adminOnly && !v.canAccessAdmin) return false;
      if (item.authOnly && !v.signedIn) return false;
      if (item.hideForPlatformAdmin && v.isPlatformAdmin) return false;
      return true;
    });
    return items.length ? { ...group, items } : null;
  }).filter((g): g is NavGroup => g !== null);
}

/** Pathname of a nav href, ignoring any query string. */
export function navPath(href: string): string {
  const q = href.indexOf("?");
  return q === -1 ? href : href.slice(0, q);
}

/**
 * Whether this nav item is the current page.
 *
 * The five 記録 steps share `/record` and differ only by `?step=`; when the
 * query is missing, step 1 is the default so a bare `/record` still lights up
 * 実験選択 rather than every item in the group.
 */
export function navItemActive(
  item: NavItem,
  pathname: string,
  searchParams?: { get(name: string): string | null },
): boolean {
  const path = navPath(item.href);
  const pathMatches = item.exact
    ? pathname === path
    : pathname === path || pathname.startsWith(`${path}/`);
  if (!pathMatches) return false;

  const query = item.href.includes("?") ? item.href.slice(item.href.indexOf("?") + 1) : "";
  if (!query) return true;
  const expected = new URLSearchParams(query);
  for (const [key, value] of expected) {
    const actual = searchParams?.get(key) ?? (key === "step" ? "1" : null);
    if (actual !== value) return false;
  }
  return true;
}

/** The label for the current route, used as the header title. */
export function titleForPath(pathname: string, search?: string): string {
  const searchParams = new URLSearchParams(search ?? "");
  let best: { label: string; length: number } | null = null;
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (!navItemActive(item, pathname, searchParams)) continue;
      if (!best || item.href.length > best.length) {
        best = { label: item.label, length: item.href.length };
      }
    }
  }
  if (best) return best.label;
  if (pathname.startsWith("/login")) return "ログイン";
  if (pathname.startsWith("/register")) return "登録";
  if (pathname.startsWith("/auth")) return "認証";
  return "LABNOTE";
}
