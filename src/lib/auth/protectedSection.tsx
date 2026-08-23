import type { ReactNode } from "react";
import { requireUser } from "./guards";

/**
 * Layout guard for a section only signed-in users may reach.
 *
 * The research tools used to render for anonymous visitors in a degraded,
 * save-nothing mode. Now that `/` is a public landing page explaining the
 * product, that half-usable state has no audience left: a visitor who has
 * not signed in should be shown the landing page or the login form, not an
 * experiment picker with nothing in it.
 *
 * This runs in a server layout, so no page underneath can be reached by
 * typing its URL — the same shape as `src/app/admin/layout.tsx`. It protects
 * the view only; every server action still re-checks authority for itself,
 * because a layout cannot guard a mutation.
 *
 * `path` is where the user is sent back to after logging in, so it must match
 * the route the layout is placed in.
 */
export function protectedSection(path: string) {
  return async function ProtectedSection({ children }: { children: ReactNode }) {
    await requireUser(path);
    return <>{children}</>;
  };
}
