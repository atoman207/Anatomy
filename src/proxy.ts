import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { AUTH_COOKIE_ENCODE } from "@/lib/supabase/authCookies";

/** Node and many hosts reject Cookie headers much past 8–16 KB. */
const COOKIE_HEADER_BUDGET = 8_192;

/**
 * Paths that require a signed-in user before they render at all.
 *
 * Everything except the landing page at `/`, the login form and the auth
 * callback. Each of these routes also has its own server-side guard (see
 * `protectedSection` and `src/app/admin/layout.tsx`), which is what actually
 * enforces access; this list only saves the visitor a flash of a page they
 * were never going to keep.
 */
const PROTECTED_PREFIXES = [
  "/admin", "/account", "/billing", "/dashboard", "/labs",
  "/analyze", "/calculator", "/experiments", "/literature",
  "/notebook", "/organize", "/peer-review", "/reagents", "/voice",
];

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
  // HTTP 431 happens before any page can render when Cookie is too large
  // (common after an avatar data URL landed in the Supabase session).
  if ((request.headers.get("cookie") ?? "").length > COOKIE_HEADER_BUDGET) {
    return expireOversizedCookies(request);
  }

  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // The analysis tools work without Supabase configured; don't hard-fail here.
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      encode: AUTH_COOKIE_ENCODE,
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

function expireOversizedCookies(request: NextRequest): NextResponse {
  const names = request.cookies.getAll().map((cookie) => cookie.name);
  const authNames = names.filter((name) => name.startsWith("sb-"));
  const toExpire = authNames.length > 0 ? authNames : names;

  for (const name of toExpire) {
    request.cookies.delete(name);
  }

  const response = NextResponse.next({ request });
  for (const name of toExpire) {
    response.cookies.set(name, "", {
      path: "/",
      maxAge: 0,
      expires: new Date(0),
      sameSite: "lax",
    });
  }
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
