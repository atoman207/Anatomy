import { NextResponse, type NextRequest } from "next/server";

import { suppress } from "@/lib/email/suppressions";
import { verifyUnsubscribeToken } from "@/lib/email/token";

/**
 * The unsubscribe endpoint named by every broadcast's `List-Unsubscribe`
 * header, and by the link in its footer.
 *
 * Two callers with different needs:
 *
 *   - A mail provider performing RFC 8058 one-click: a POST with the body
 *     `List-Unsubscribe=One-Click`, no session, no confirmation page. It must
 *     take effect immediately and answer 200.
 *   - A person clicking the link: they land on /unsubscribe, see which
 *     address is about to be removed, and press a button that posts here.
 *
 * `GET` deliberately does **not** unsubscribe anyone. Link scanners and
 * antivirus proxies fetch URLs out of mail before a human sees them, so a GET
 * that opted people out would quietly unsubscribe recipients who never
 * clicked anything. It redirects to the confirmation page instead.
 */

export const dynamic = "force-dynamic";

function tokenOf(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get("t");
}

export async function GET(request: NextRequest) {
  const token = tokenOf(request);
  const target = new URL("/unsubscribe", request.nextUrl.origin);
  if (token) target.searchParams.set("t", token);
  return NextResponse.redirect(target);
}

export async function POST(request: NextRequest) {
  const token = tokenOf(request);
  const email = verifyUnsubscribeToken(token);

  // What the provider's one-click POST carries; a browser form does not.
  const body = await request.text().catch(() => "");
  const oneClick = body.includes("List-Unsubscribe=One-Click");

  if (!email) {
    return oneClick
      ? new NextResponse("invalid token", { status: 400 })
      : redirectToPage(request, token, "invalid");
  }

  const stored = await suppress(email, "unsubscribe", "list-unsubscribe");

  if (oneClick) {
    // 200 only when the opt-out is really recorded: answering OK while having
    // dropped it would tell the provider the button works when it does not.
    return stored
      ? new NextResponse("unsubscribed", { status: 200 })
      : new NextResponse("could not record unsubscribe", { status: 500 });
  }
  return redirectToPage(request, token, stored ? "done" : "error");
}

/** Sends a browser back to the page with the outcome to show. */
function redirectToPage(request: NextRequest, token: string | null, state: string): NextResponse {
  const target = new URL("/unsubscribe", request.nextUrl.origin);
  if (token) target.searchParams.set("t", token);
  target.searchParams.set("state", state);
  // 303, so the browser follows with GET rather than re-posting.
  return NextResponse.redirect(target, 303);
}
