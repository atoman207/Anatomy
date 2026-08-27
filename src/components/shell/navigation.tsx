import type { ReactNode } from "react";

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

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-[18px] w-[18px] shrink-0" {...stroke}>
      {children}
    </svg>
  );
}

const icons = {
  team: (
    <Icon>
      <circle cx="8" cy="8" r="3.2" />
      <path d="M2 20a6 6 0 0 1 12 0" />
      <path d="M15 5.2a3.2 3.2 0 0 1 0 5.6" />
      <path d="M17 20a6 6 0 0 0-2-4.5" />
    </Icon>
  ),
  chat: (
    <Icon>
      <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-4.3 3.6A.5.5 0 0 1 4 19.2z" />
    </Icon>
  ),
  dashboard: (
    <Icon>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Icon>
  ),
  organize: (
    <Icon>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M3 11h18" />
    </Icon>
  ),
  analyze: (
    <Icon>
      <path d="M4 20V10M10 20V4M16 20v-6M22 20H2" />
    </Icon>
  ),
  voice: (
    <Icon>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
    </Icon>
  ),
  notebook: (
    <Icon>
      <path d="M5 4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
      <path d="M9 3v18M12 8h4M12 12h4" />
    </Icon>
  ),
  literature: (
    <Icon>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.3-4.3" />
    </Icon>
  ),
  experiments: (
    <Icon>
      <path d="M9 3v6.5L4.2 17A2 2 0 0 0 6 20h12a2 2 0 0 0 1.8-3L15 9.5V3" />
      <path d="M8 3h8M7.5 14h9" />
    </Icon>
  ),
  calculator: (
    <Icon>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M8 6h8M8 11h1M12 11h1M16 11h1M8 15h1M12 15h1M16 15h1M8 19h1M12 19h1M16 19h1" />
    </Icon>
  ),
  reagents: (
    <Icon>
      <path d="M9 2h6M10 2v6.5L5.5 17A2.5 2.5 0 0 0 7.7 21h8.6a2.5 2.5 0 0 0 2.2-3.9L14 8.5V2" />
      <path d="M8 15h8" />
    </Icon>
  ),
  adminHome: (
    <Icon>
      <path d="M12 3 4 7v5c0 4.4 3.2 8.3 8 9 4.8-.7 8-4.6 8-9V7z" />
    </Icon>
  ),
  members: (
    <Icon>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 20a6 6 0 0 0-2-4.5" />
    </Icon>
  ),
  labs: (
    <Icon>
      <path d="M3 21V8l7-5 7 5v13" />
      <path d="M3 21h18M10 21v-5h4v5M7 11h.01M13 11h.01" />
    </Icon>
  ),
  users: (
    <Icon>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Icon>
  ),
  templates: (
    <Icon>
      <path d="M5 4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
      <path d="M9 3v18M12 8h4M12 12h4M12 16h4" />
    </Icon>
  ),
  content: (
    <Icon>
      <ellipse cx="12" cy="5.5" rx="8" ry="2.5" />
      <path d="M4 5.5V12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V5.5" />
      <path d="M4 12v6.5c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V12" />
    </Icon>
  ),
  audit: (
    <Icon>
      <path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5M8 13h8M8 17h5" />
    </Icon>
  ),
  peerReview: (
    <Icon>
      <path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
      <path d="m9 14.5 2 2 4.5-4.5" />
    </Icon>
  ),
  billing: (
    <Icon>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M2.5 10h19M6 15h4" />
    </Icon>
  ),
  contracts: (
    <Icon>
      <path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </Icon>
  ),
  account: (
    <Icon>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 15H3a2 2 0 1 1 0-4h.2A1.6 1.6 0 0 0 4.3 8.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 4.4V4a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.4a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1.2z" />
    </Icon>
  ),
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "work",
    label: null,
    items: [
      { href: "/dashboard", label: "ダッシュボード", icon: icons.dashboard, exact: true },
      { href: "/labs", label: "研究室", icon: icons.team, authOnly: true },
      { href: "/chat", label: "チャット", icon: icons.chat, authOnly: true },
    ],
  },
  {
    id: "record",
    label: "記録",
    items: [
      { href: "/record?step=1", label: "実験選択", icon: icons.experiments },
      { href: "/record?step=2", label: "試薬・Lot", icon: icons.reagents },
      { href: "/record?step=3", label: "テンプレート", icon: icons.templates },
      { href: "/record?step=4", label: "実験ノート", icon: icons.notebook },
      { href: "/record?step=5", label: "論文検索", icon: icons.literature },
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
      { href: "/admin/labs", label: "研究室", icon: icons.labs, adminOnly: true },
      { href: "/admin/experiments", label: "実験", icon: icons.experiments, adminOnly: true },
      { href: "/admin/templates", label: "テンプレート", icon: icons.templates, adminOnly: true },
      { href: "/admin/users", label: "ユーザー", icon: icons.users, platformOnly: true },
      { href: "/admin/peer-review", label: "AI査読者", icon: icons.peerReview, platformOnly: true },
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
  if (pathname.startsWith("/auth")) return "認証";
  return "LABNOTE.";
}
