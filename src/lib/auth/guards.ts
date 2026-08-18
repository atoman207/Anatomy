import "server-only";

import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createServerSupabase, createAdminSupabase, isSupabaseConfigured } from "@/lib/supabase/server";
import type { LabRole } from "@/lib/supabase/types";
import { canManageMembers, isPlatformAdminEmail } from "./roles";

export interface LabMembership {
  labId: string;
  labName: string;
  labDescription: string | null;
  ownerId: string;
  role: LabRole;
  joinedAt: string;
}

export interface SessionContext {
  user: User;
  email: string;
  displayName: string;
  isPlatformAdmin: boolean;
  memberships: LabMembership[];
  /** Labs where this user may manage members. */
  adminLabs: LabMembership[];
  /** True when the user can reach the admin area at all. */
  canAccessAdmin: boolean;
}

/**
 * Loads the signed-in user with every role fact the UI needs, in one place.
 *
 * Returns null rather than throwing when signed out, so callers can choose
 * between redirecting and rendering a signed-out view.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const user = data.user;

  const { data: rows } = await supabase
    .from("lab_members")
    .select("lab_id, role, joined_at, laboratories(id, name, description, owner_id)")
    .order("joined_at", { ascending: true });

  const memberships: LabMembership[] = [];
  for (const row of rows ?? []) {
    const embedded = row.laboratories as unknown;
    const lab = (Array.isArray(embedded) ? embedded[0] : embedded) as
      | { id: string; name: string; description: string | null; owner_id: string }
      | null
      | undefined;
    if (!lab) continue;
    memberships.push({
      labId: lab.id,
      labName: lab.name,
      labDescription: lab.description,
      ownerId: lab.owner_id,
      role: row.role as LabRole,
      joinedAt: row.joined_at,
    });
  }

  const isPlatformAdmin = isPlatformAdminEmail(user.email);
  const adminLabs = memberships.filter((m) => canManageMembers(m.role));

  const metaName =
    (user.user_metadata?.display_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined);

  return {
    user,
    email: user.email ?? "",
    displayName: metaName || (user.email ?? "").split("@")[0] || "user",
    isPlatformAdmin,
    memberships,
    adminLabs,
    canAccessAdmin: isPlatformAdmin || adminLabs.length > 0,
  };
}

/** Redirects to the login page, preserving where the user was heading. */
export async function requireUser(nextPath = "/admin"): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return ctx;
}

/** Requires the ability to administer at least one laboratory, or the platform. */
export async function requireAdmin(nextPath = "/admin"): Promise<SessionContext> {
  const ctx = await requireUser(nextPath);
  if (!ctx.canAccessAdmin) redirect("/?denied=admin");
  return ctx;
}

export async function requirePlatformAdmin(nextPath = "/admin"): Promise<SessionContext> {
  const ctx = await requireUser(nextPath);
  if (!ctx.isPlatformAdmin) redirect("/admin?denied=platform");
  return ctx;
}

/**
 * Authoritative check that a user may manage a specific laboratory.
 *
 * Every admin action re-derives this from the database rather than trusting a
 * lab id posted from the browser. Platform admins pass for any lab.
 */
export async function assertCanManageLab(
  ctx: SessionContext,
  labId: string,
): Promise<void> {
  if (ctx.isPlatformAdmin) return;
  const membership = ctx.memberships.find((m) => m.labId === labId);
  if (!canManageMembers(membership?.role)) {
    throw new Error("この研究室を管理する権限がありません。");
  }
}

/** Only the lab owner, or a platform admin, may do this. */
export async function assertIsLabOwner(
  ctx: SessionContext,
  labId: string,
): Promise<void> {
  if (ctx.isPlatformAdmin) return;
  const membership = ctx.memberships.find((m) => m.labId === labId);
  if (membership?.role !== "owner") {
    throw new Error("研究室のオーナーのみが実行できます。");
  }
}

export interface AuditEntry {
  labId: string | null;
  userId: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * Appends to the audit trail.
 *
 * Written with the service-role client because platform-level actions have no
 * lab id, and the append-only RLS policy requires one. Audit failures are
 * swallowed: losing a log line must never abort the action the user asked for,
 * and the alternative - failing the request - would be worse.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const admin = createAdminSupabase();
    await admin.from("audit_logs").insert({
      lab_id: entry.labId,
      user_id: entry.userId,
      action: entry.action,
      entity: entry.entity ?? null,
      entity_id: entry.entityId ?? null,
      detail: (entry.detail ?? {}) as never,
    });
  } catch {
    // Intentionally silent - see the note above.
  }
}
