import type { LabRole, PlatformRole } from "@/lib/supabase/types";

/**
 * Two independent levels of authority:
 *
 * - **Lab role** (`lab_members.role`) governs one laboratory's data and is
 *   enforced in the database by row-level security.
 * - **Platform role** (`profiles.platform_role`) governs the deployment
 *   itself - every user, every lab. Only two values exist, and they are the
 *   two roles the product talks about: Administrator and User.
 *
 * The platform role lives in the database so an administrator can grant it
 * without a redeploy, but the column is writable only by the service role (a
 * trigger in migration 0002 enforces it), so the row an attacker could reach
 * is not one they can flip. `PLATFORM_ADMIN_EMAILS` is retained purely as a
 * lockout-recovery path.
 */

export const LAB_ROLES: LabRole[] = ["owner", "admin", "member", "viewer"];

export const PLATFORM_ROLES: PlatformRole[] = ["admin", "user"];

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, { ja: string; hint: string }> = {
  admin: {
    ja: "管理者",
    hint: "全ユーザー・全研究室・全実験・全テンプレートを管理できます。",
  },
  user: {
    ja: "ユーザー",
    hint: "所属研究室の研究機能のみ利用できます。管理機能は利用できません。",
  },
};

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
 * This is the lockout-recovery path, not the primary source of truth: the
 * role now lives in `profiles.platform_role`. An address listed here is an
 * administrator even if its profile row says otherwise, so a bad seed or a
 * mistaken demotion never leaves the deployment with no way back in.
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

/**
 * The deployment-wide role for one account.
 *
 * The database column decides; the environment allowlist can only ever add an
 * administrator, never remove one, so a misconfigured `PLATFORM_ADMIN_EMAILS`
 * cannot lock the real administrators out of their own deployment.
 */
export function resolvePlatformRole(
  columnValue: PlatformRole | null | undefined,
  email: string | null | undefined,
): PlatformRole {
  if (columnValue === "admin") return "admin";
  if (isPlatformAdminEmail(email)) return "admin";
  return "user";
}
