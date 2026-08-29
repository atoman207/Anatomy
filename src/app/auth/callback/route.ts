import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth/guards";
import { postLoginPathForSession } from "@/lib/auth/postLogin";
import { acceptPendingLabInvites } from "@/lib/labs/actions";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lands every emailed auth link: sign-up confirmation, password recovery and
 * invitations.
 *
 * Supabase sends either a PKCE `code` or a `token_hash` + `type` pair
 * depending on the project's email templates, so both are handled. Without
 * this route those links dead-end and the account can never be confirmed.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const rawNext = searchParams.get("next");

  // Supabase reports link failures (expired, already used) on the query string.
  const errorDescription =
    searchParams.get("error_description") ?? searchParams.get("error");
  if (errorDescription) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("invalid_link")}`);
  }

  const supabase = await createServerSupabase();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("invalid_link")}`);
    }
    await consumePendingLabInvites(supabase);
    // A recovery link must land on the page that sets a new password,
    // otherwise the one-time session is spent going somewhere useless.
    const ctx = await getSessionContext();
    const target =
      type === "recovery"
        ? "/auth/reset"
        : postLoginPathForSession(rawNext, ctx?.canAccessAdmin ?? false);
    return NextResponse.redirect(`${origin}${target}`);
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as "signup" | "recovery" | "invite" | "email_change" | "magiclink",
      token_hash: tokenHash,
    });
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("invalid_link")}`);
    }
    await consumePendingLabInvites(supabase);
    const ctx = await getSessionContext();
    const target =
      type === "recovery"
        ? "/auth/reset"
        : postLoginPathForSession(rawNext, ctx?.canAccessAdmin ?? false);
    return NextResponse.redirect(`${origin}${target}`);
  }

  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("invalid_link")}`);
}

/**
 * Adds this freshly authenticated account to every laboratory it was
 * invited to. Best-effort: a failure here must never break sign-in, so any
 * error is swallowed the same way `logAudit` swallows its own.
 */
async function consumePendingLabInvites(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
): Promise<void> {
  try {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (user?.email) {
      await acceptPendingLabInvites(user.id, user.email);
    }
  } catch {
    // Intentionally silent - see the note above.
  }
}
