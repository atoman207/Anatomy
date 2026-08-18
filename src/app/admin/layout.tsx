import Link from "next/link";
import { Badge } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guards";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { LAB_ROLE_LABELS } from "@/lib/auth/roles";
import type { LabRole } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

/**
 * Guards the whole admin area.
 *
 * The check runs here, in a server layout, so no admin page can be reached by
 * navigating straight to its URL. Individual actions re-check independently -
 * a layout guard protects the view, not the mutation.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const ctx = await requireAdmin();

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-ink">管理</h1>
          <p className="mt-1 text-[15px] text-ink-2">
            {ctx.displayName} ({ctx.email})
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ctx.isPlatformAdmin && <Badge tone="accent">システム管理者</Badge>}
          {ctx.adminLabs.map((l) => (
            <Badge key={l.labId} tone="neutral">
              {l.labName}: {LAB_ROLE_LABELS[l.role as LabRole]?.ja ?? l.role}
            </Badge>
          ))}
          <Link href="/experiments" className="text-xs text-accent underline">
            実験一覧へ
          </Link>
        </div>
      </header>

      <AdminTabs isPlatformAdmin={ctx.isPlatformAdmin} />

      {children}
    </div>
  );
}
