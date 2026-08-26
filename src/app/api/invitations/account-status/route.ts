import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/guards";
import { createAdminSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findUserByEmail(email: string) {
  const admin = createAdminSupabase();
  let page = 1;
  while (page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
    page++;
  }
  return null;
}

export async function GET(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const email = String(searchParams.get("email") ?? "").trim().toLowerCase();
  if (!email.includes("@")) {
    return NextResponse.json({ exists: false, valid: false });
  }

  const user = await findUserByEmail(email);
  return NextResponse.json({ exists: Boolean(user), valid: true });
}
