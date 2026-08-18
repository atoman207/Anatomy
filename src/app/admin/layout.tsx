import { requireAdmin } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

/**
 * Guards the admin area.
 *
 * There is no separate admin chrome any more: the sidebar already lists the
 * administration pages for anyone entitled to them, so an administrator moves
 * between managing members and running an analysis without changing context.
 * What remains here is purely the access check.
 *
 * It runs in a server layout, so no admin page can be reached by typing its
 * URL. Every server action re-checks independently — a layout guard protects
 * the view, not the mutation.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin();
  return <>{children}</>;
}
