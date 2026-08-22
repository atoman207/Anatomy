import Link from "next/link";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, Callout, Card, EmptyState, StatTile } from "@/components/ui";
import { RevenueChart } from "@/components/admin/RevenueChart";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminSupabase } from "@/lib/supabase/server";
import { LAB_ROLE_LABELS } from "@/lib/auth/roles";
import { loadBillingDashboard } from "@/lib/billing/dashboardActions";
import { formatMoney, GRANULARITY_LABELS } from "@/lib/billing/revenue";
import type { BillingDashboardData } from "@/lib/billing/dashboardTypes";
import { NAV_GROUPS } from "@/components/shell/navigation";

export const dynamic = "force-dynamic";

/**
 * Short blurbs for every /admin/* section, keyed by href. Kept next to the
 * page rather than in navigation.tsx because they're prose for this one
 * overview grid, not part of the nav's own data — the icon and label still
 * come from NAV_GROUPS so the two never drift apart.
 */
const ADMIN_SECTION_DESCRIPTIONS: Record<string, string> = {
  "/admin/members": "研究室ごとの所属と役割。",
  "/admin/labs": "研究室の作成・設定・削除。",
  "/admin/experiments": "全研究室の実験を作成・編集・削除。",
  "/admin/templates": "全テンプレートの確認・編集・削除。",
  "/admin/users": "アカウントの作成・権限変更・削除。",
  "/admin/peer-review": "AI査読者の名前と採点ルーブリックを編集。",
  "/admin/content": "研究室データを横断的に検索・削除。",
  "/admin/billing": "Stripe の売上・顧客状況を確認。",
  "/admin/subscriptions": "研究室ごとのプラン・支払い状態を管理。",
  "/admin/billing/prices": "プランの月額と Stripe 価格を設定。",
  "/admin/audit": "追記のみの操作履歴。",
};

/** Past week at daily grain — the overview chart should scan in one glance. */
const OVERVIEW_RANGE_DAYS = 7;
const OVERVIEW_GRANULARITY = "day" as const;

interface Counts {
  experiments: number;
  datasets: number;
  analyses: number;
  figures: number;
  notebook_entries: number;
  notebook_templates: number;
  members: number;
}

/** Counts rows per table for the laboratories this admin can see. */
async function countsForLabs(labIds: string[]): Promise<Counts> {
  const empty: Counts = {
    experiments: 0, datasets: 0, analyses: 0, figures: 0,
    notebook_entries: 0, notebook_templates: 0, members: 0,
  };
  if (labIds.length === 0) return empty;

  const admin = createAdminSupabase();
  const tables = [
    "experiments", "datasets", "analyses", "figures", "notebook_entries",
    "notebook_templates", "lab_members",
  ] as const;

  const out = { ...empty };
  for (const t of tables) {
    const { count } = await admin
      .from(t)
      .select("lab_id", { count: "exact", head: true })
      .in("lab_id", labIds);
    if (t === "lab_members") out.members = count ?? 0;
    else out[t] = count ?? 0;
  }
  return out;
}

/** How many accounts hold each platform role. */
async function platformRoleCounts(): Promise<{ admins: number; users: number }> {
  const admin = createAdminSupabase();
  const [{ count: admins }, { count: total }] = await Promise.all([
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("platform_role", "admin"),
    admin.from("profiles").select("id", { count: "exact", head: true }),
  ]);
  return { admins: admins ?? 0, users: (total ?? 0) - (admins ?? 0) };
}

export default async function AdminOverviewPage(props: PageProps<"/admin">) {
  const ctx = await requireAdmin();
  const search = await props.searchParams;
  const denied = typeof search.denied === "string" ? search.denied : null;

  const visibleLabs = ctx.isPlatformAdmin ? await allLabs() : ctx.adminLabs;
  const counts = await countsForLabs(visibleLabs.map((l) => l.labId));
  const roleCounts = await platformRoleCounts();

  const recent = await recentAudit(
    ctx.isPlatformAdmin ? null : visibleLabs.map((l) => l.labId),
  );

  // Stripe revenue is platform-wide; laboratory admins do not see it here.
  const revenue: BillingDashboardData | null = ctx.isPlatformAdmin
    ? (await loadBillingDashboard(OVERVIEW_RANGE_DAYS, OVERVIEW_GRANULARITY)).data ?? null
    : null;

  const adminSections = (NAV_GROUPS.find((g) => g.id === "admin")?.items ?? []).filter(
    (item) => item.href !== "/admin" && (!item.platformOnly || ctx.isPlatformAdmin),
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="管理者ダッシュボード"
        description={`${ctx.displayName}（${ctx.email}）`}
        meta={
          <>
            {ctx.isPlatformAdmin && <Badge tone="accent">システム管理者</Badge>}
            {ctx.adminLabs.map((l) => (
              <Badge key={l.labId} tone="neutral">
                {l.labName}: {LAB_ROLE_LABELS[l.role].ja}
              </Badge>
            ))}
          </>
        }
      />
      {denied === "platform" && (
        <Callout tone="warn" title="システム管理者専用">
          そのセクションはシステム管理者のみ利用できます。研究室の管理はこちらから行えます。
        </Callout>
      )}

      {revenue && (
        <Card>
          <RevenueChart
            buckets={revenue.buckets}
            currency={revenue.currency}
            granularity={revenue.granularity}
            title={`${GRANULARITY_LABELS[revenue.granularity]}の売上推移`}
            subtitle={
              revenue.summary.best && revenue.summary.best.net > 0
                ? `最高は ${revenue.summary.best.longLabel} の ${formatMoney(revenue.summary.best.net, revenue.currency)}`
                : "過去7日間の純売上（返金差引後）"
            }
          />
        </Card>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink-2">管理機能</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {adminSections.map((item) => (
            <Link key={item.href} href={item.href} className="group">
              <Card className="card-hover h-full">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
                    {item.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[16px] font-medium text-ink group-hover:text-accent">
                      {item.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-3">
                      {ADMIN_SECTION_DESCRIPTIONS[item.href] ?? ""}
                    </span>
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <StatTile label="管理者" value={roleCounts.admins} tone="accent" />
        <StatTile label="ユーザー" value={roleCounts.users} />
        <StatTile label="研究室" value={visibleLabs.length} />
        <StatTile label="メンバー" value={counts.members} />
        <StatTile label="実験" value={counts.experiments} />
        <StatTile label="テンプレート" value={counts.notebook_templates} />
        <StatTile label="データセット" value={counts.datasets} />
        <StatTile label="解析" value={counts.analyses} />
      </div>

      <Card
        title="最近の操作"
        subtitle="自動的に追記されます。編集・削除はできません。"
        actions={
          <Link href="/admin/audit" className="text-xs text-accent underline">
            すべて表示
          </Link>
        }
      >
        {recent.length === 0 ? (
          <EmptyState title="まだ操作は記録されていません" />
        ) : (
          <ul className="columns-1 gap-x-6 text-xs sm:columns-2">
            {recent.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] py-2 [break-inside:avoid]"
              >
                <span className="font-mono text-ink">{r.action}</span>
                <span className="text-ink-3">
                  {new Date(r.created_at).toLocaleString("ja-JP")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

async function allLabs() {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("laboratories")
    .select("id, name, description, owner_id")
    .order("created_at", { ascending: true });
  return (data ?? []).map((l) => ({
    labId: l.id,
    labName: l.name,
    labDescription: l.description,
    ownerId: l.owner_id,
    role: "admin" as const,
    joinedAt: "",
  }));
}

async function recentAudit(labIds: string[] | null) {
  const admin = createAdminSupabase();
  let query = admin
    .from("audit_logs")
    .select("id, action, created_at, lab_id")
    .order("created_at", { ascending: false })
    .limit(12);
  if (labIds) {
    if (labIds.length === 0) return [];
    query = query.in("lab_id", labIds);
  }
  const { data } = await query;
  return data ?? [];
}
