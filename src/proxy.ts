import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/** Paths that require a signed-in user before they render at all. */
const PROTECTED_PREFIXES = ["/admin"];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * Refreshes the Supabase auth session on every request so server components
 * see a valid user. Without this the access token expires and pages start
 * rendering as signed-out mid-session.
 *
 * It also turns signed-out hits on the admin area into a redirect. The page
 * guards are what actually enforce access - this only spares the visitor a
 * flash of a page they were never going to keep.
 */
export default async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // The analysis tools work without Supabase configured; don't hard-fail here.
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet) {
        for (const { name, value } of toSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  try {
    const { data } = await supabase.auth.getUser();
    const pathname = request.nextUrl.pathname;

    if (!data.user && isProtected(pathname)) {
      const login = new URL("/login", request.url);
      login.searchParams.set("next", pathname + request.nextUrl.search);
      return NextResponse.redirect(login);
    }
  } catch {
    // A transient auth outage should not take the whole app down; the page
    // guards still refuse to render protected content without a user.
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
