import { NextResponse } from "next/server";
import { getAnamPersona, isAnamEnabled } from "@/lib/ai/anam";

export const runtime = "nodejs";

/** The persona's portrait thumbnail (chat bubbles, header), from Anam Lab. */
export async function GET() {
  if (!isAnamEnabled()) return new NextResponse(null, { status: 404 });
  try {
    const { portraitImageUrl } = await getAnamPersona();
    if (!portraitImageUrl) return new NextResponse(null, { status: 404 });
    return NextResponse.redirect(portraitImageUrl, {
      status: 302,
      headers: { "Cache-Control": "public, max-age=1800" },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
