import { NextResponse } from "next/server";
import { getAnamPersona, isAnamEnabled } from "@/lib/ai/anam";

export const runtime = "nodejs";

/**
 * The persona's looping idle clip - shown (muted) while the live stream is
 * connecting, and in the launcher, so she is never a still image.
 *
 * Redirects to a fresh signed URL from the Anam API; those expire after about
 * an hour, so they cannot be baked into the page.
 */
export async function GET() {
  if (!isAnamEnabled()) return new NextResponse(null, { status: 404 });
  try {
    const { idleVideoUrl } = await getAnamPersona();
    if (!idleVideoUrl) return new NextResponse(null, { status: 404 });
    return NextResponse.redirect(idleVideoUrl, {
      status: 302,
      // Shorter than the signed URL's remaining life (>= 30 min, see PERSONA_CACHE_MS).
      headers: { "Cache-Control": "private, max-age=600" },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
