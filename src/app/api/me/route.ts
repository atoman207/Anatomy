import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/guards";
import type { PlatformRole } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface MeResponse {
  signedIn: boolean;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /** "admin" or "user"; "user" whenever signed out. */
  platformRole: PlatformRole;
  isPlatformAdmin: boolean;
  canAccessAdmin: boolean;
  labs: { id: string; name: string; role: string }[];
}

/**
 * Identity and role summary for the navigation bar.
 *
 * Platform-admin status is decided from server-only configuration, so the
 * client cannot compute it and has to ask. What comes back is used to decide
 * what to *show*; every protected page and action re-checks server-side.
 */
export async function GET() {
  const ctx = await getSessionContext();

  const body: MeResponse = ctx
    ? {
        signedIn: true,
        email: ctx.email,
        displayName: ctx.displayName,
        avatarUrl: ctx.avatarUrl,
        platformRole: ctx.platformRole,
        isPlatformAdmin: ctx.isPlatformAdmin,
        canAccessAdmin: ctx.canAccessAdmin,
        labs: ctx.memberships.map((m) => ({ id: m.labId, name: m.labName, role: m.role })),
      }
    : {
        signedIn: false,
        email: null,
        displayName: null,
        avatarUrl: null,
        platformRole: "user",
        isPlatformAdmin: false,
        canAccessAdmin: false,
        labs: [],
      };

  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
