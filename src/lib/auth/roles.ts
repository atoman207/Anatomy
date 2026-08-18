import type { LabRole } from "@/lib/supabase/types";

/**
 * Two independent levels of authority:
 *
 * - **Lab role** (`lab_members.role`) governs one laboratory's data and is
 *   enforced in the database by row-level security.
 * - **Platform admin** governs the deployment itself - every user, every lab.
 *   It is deliberately *not* a database column: a row an attacker could flip
 *   would be a privilege-escalation path, so the list lives in server-only
 *   configuration and is never sent to the browser as authority.
 */

export const LAB_ROLES: LabRole[] = ["owner", "admin", "member", "viewer"];

export const LAB_ROLE_LABELS: Record<LabRole, { ja: string; hint: string }> = {
  owner: {
    ja: "オーナー",
    hint: "研究室の完全な管理権限（削除を含む）。オーナーは除名できません。",
  },
  admin: {
    ja: "管理者",
    hint: "メンバーとすべてのデータを管理できますが、研究室は削除できません。",
  },
  member: {
    ja: "メンバー",
    hint: "実験、データセット、ノートエントリの作成・編集ができます。",
  },
  viewer: {
    ja: "閲覧者",
    hint: "研究室内のすべてのデータを閲覧のみ可能です。",
  },
};

/** Ranked so comparisons stay readable: a higher number outranks a lower one. */
const RANK: Record<LabRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

export function roleAtLeast(role: LabRole | null | undefined, minimum: LabRole): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[minimum];
}

export function canManageMembers(role: LabRole | null | undefined): boolean {
  return roleAtLeast(role, "admin");
}

export function canWrite(role: LabRole | null | undefined): boolean {
  return roleAtLeast(role, "member");
}

/**
 * Reads the platform-admin allowlist.
 *
 * Server-only: `PLATFORM_ADMIN_EMAILS` has no NEXT_PUBLIC_ prefix, so it never
 * reaches the client bundle. Comparison is case-insensitive and trimmed
 * because the value is hand-edited.
 */
export function platformAdminEmails(): string[] {
  const raw = process.env.PLATFORM_ADMIN_EMAILS ?? "";
  return raw
    .split(/[,\s;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = platformAdminEmails();
  if (list.length === 0) return false;
  return list.includes(email.trim().toLowerCase());
}
