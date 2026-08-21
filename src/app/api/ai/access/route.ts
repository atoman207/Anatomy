import { NextResponse } from "next/server";
import { requireAiAccess } from "@/lib/billing/subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight entitlement probe for the client.
 *
 * Paid AI controls (voice engine picker, summarize buttons) ask here before
 * spending a full request, so a free-plan laboratory gets a toast and a path
 * to billing instead of an inline error after the fact.
 */
export async function GET(request: Request) {
  const labId = new URL(request.url).searchParams.get("labId");
  const gate = await requireAiAccess(labId);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false as const, error: gate.error },
      { status: gate.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { ok: true as const, labId: gate.labId },
    { headers: { "Cache-Control": "no-store" } },
  );
}
