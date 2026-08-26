import Link from "next/link";
import { Badge, Callout, Card, DataTable, EmptyState, StatTile } from "@/components/ui";
import { AdminRevenuePanel } from "@/components/admin/AdminRevenuePanel";
import { MemberPaymentDonut } from "@/components/admin/MemberPaymentDonut";
import { MemberUsersPanel, type MemberPaymentUser } from "@/components/admin/MemberUsersPanel";
import { SignupTrendChart } from "@/components/admin/SignupTrendChart";
import { PricingBarChart, type PriceBar } from "@/components/admin/PricingBarChart";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminSupabase } from "@/lib/supabase/server";
import { loadBillingDashboard } from "@/lib/billing/dashboardActions";
import { listPayments } from "@/lib/billing/stripeAdmin";
import { formatBillingPeriod, PLAN_LIST, STATUS_LABELS, type PlanId } from "@/lib/billing/plans";
import { getPlanPrices } from "@/lib/billing/priceStore";
import { planOffers } from "@/lib/billing/priceResolution";
import { isMockCheckoutAllowed } from "@/lib/billing/stripe";
import { PEER_REVIEW_CREDIT_PACKS } from "@/lib/peerReview/creditPacks";
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

/**
 * "Paid at least once" is derived, not stored on the account directly, so it
 * is computed from the two places money actually moves:
 *
 * 1. `peer_review_credits.total_purchased > 0` - a personal AI査読 credit
 *    purchase, only ever incremented from a completed Stripe checkout (see
 *    grantPeerReviewCredits, called only by the webhook).
 * 2. The owner of a laboratory whose `lab_subscriptions.stripe_subscription_id`
 *    is set - a real subscription was created at least once, even if it has
 *    since lapsed or been canceled. A lab subscription is billed to its
 *    owner, so the owner is who "paid", not every member of that lab.
 *
 * The roster also attaches lifetime net paid (Stripe charges matched by
 * email) and sign-up date, with platform administrators sorted first.
 */
async function memberPaymentOverview(): Promise<{
  totalMembers: number;
  payingMembers: number;
  users: MemberPaymentUser[];
}> {
  const admin = createAdminSupabase();
  const sinceMs = Date.now() - 3650 * 24 * 60 * 60 * 1000;

  const [
    { data: profiles },
    creditBuyersRes,
    subscribedLabsRes,
    labsRes,
    payments,
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("id, email, display_name, platform_role, created_at")
      .order("created_at", { ascending: true }),
    admin.from("peer_review_credits").select("user_id").gt("total_purchased", 0),
    admin.from("lab_subscriptions").select("lab_id").not("stripe_subscription_id", "is", null),
    admin.from("laboratories").select("id, owner_id"),
    listPayments(sinceMs),
  ]);

  const paidUserIds = new Set<string>((creditBuyersRes.data ?? []).map((r) => r.user_id));
  const subscribedLabIds = new Set<string>((subscribedLabsRes.data ?? []).map((r) => r.lab_id));
  for (const lab of labsRes.data ?? []) {
    if (subscribedLabIds.has(lab.id)) paidUserIds.add(lab.owner_id);
  }

  const paidByEmail = new Map<string, number>();
  for (const p of payments.data) {
    if (p.status !== "succeeded") continue;
    const email = p.customerEmail?.trim().toLowerCase();
    if (!email) continue;
    paidByEmail.set(email, (paidByEmail.get(email) ?? 0) + (p.amount - p.refunded));
  }

  const users: MemberPaymentUser[] = (profiles ?? [])
    .map((p) => {
      const email = (p.email ?? "").trim();
      const emailKey = email.toLowerCase();
      return {
        id: p.id,
        name: p.display_name?.trim() || email || "（無名）",
        email: email || "—",
        isAdmin: p.platform_role === "admin",
        paidTotalJpy: emailKey ? (paidByEmail.get(emailKey) ?? 0) : 0,
        signedUpAt: p.created_at,
      };
    })
    .sort((a, b) => {
      if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
      if (b.paidTotalJpy !== a.paidTotalJpy) return b.paidTotalJpy - a.paidTotalJpy;
      return a.signedUpAt < b.signedUpAt ? -1 : 1;
    });

  return {
    totalMembers: users.length,
    payingMembers: paidUserIds.size,
    users,
  };
}

interface LabOverviewRow {
  id: string;
  name: string;
  description: string | null;
  ownerName: string;
  ownerEmail: string;
  createdAt: string;
  plan: PlanId;
  status: string;
  memberCount: number;
  experimentCount: number;
}

/**
 * Every visible laboratory with the detail an administrator actually needs
 * to judge operational status at a glance — not just its name: who created
 * it, how big it is, what plan it's on, and when. Aggregated in application
 * code (four flat selects + a tally) rather than a grouped SQL query, the
 * same style `countsForLabs` above already uses in this file.
 */
async function labsOverview(labIds: string[]): Promise<LabOverviewRow[]> {
  if (labIds.length === 0) return [];
  const admin = createAdminSupabase();

  const [{ data: labs }, { data: subs }, { data: members }, { data: experiments }] = await Promise.all([
    admin.from("laboratories").select("id, name, description, owner_id, created_at").in("id", labIds),
    admin.from("lab_subscriptions").select("lab_id, plan, status").in("lab_id", labIds),
    admin.from("lab_members").select("lab_id").in("lab_id", labIds),
    admin.from("experiments").select("lab_id").in("lab_id", labIds),
  ]);

  const ownerIds = [...new Set((labs ?? []).map((l) => l.owner_id))];
  const { data: owners } = ownerIds.length
    ? await admin.from("profiles").select("id, display_name, email").in("id", ownerIds)
    : { data: [] as { id: string; display_name: string | null; email: string | null }[] };
  const ownerById = new Map((owners ?? []).map((o) => [o.id, o]));
  const subByLab = new Map((subs ?? []).map((s) => [s.lab_id, s]));

  const memberCounts = new Map<string, number>();
  for (const m of members ?? []) memberCounts.set(m.lab_id, (memberCounts.get(m.lab_id) ?? 0) + 1);
  const experimentCounts = new Map<string, number>();
  for (const e of experiments ?? []) experimentCounts.set(e.lab_id, (experimentCounts.get(e.lab_id) ?? 0) + 1);

  return (labs ?? [])
    .map((l) => {
      const owner = ownerById.get(l.owner_id);
      const sub = subByLab.get(l.id);
      return {
        id: l.id,
        name: l.name,
        description: l.description,
        ownerName: owner?.display_name?.trim() || "—",
        ownerEmail: owner?.email ?? "—",
        createdAt: l.created_at,
        plan: (sub?.plan ?? "free") as PlanId,
        status: sub?.status ?? "active",
        memberCount: memberCounts.get(l.id) ?? 0,
        experimentCount: experimentCounts.get(l.id) ?? 0,
      };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export default async function AdminOverviewPage(props: PageProps<"/admin">) {
  const ctx = await requireAdmin();
  const search = await props.searchParams;
  const denied = typeof search.denied === "string" ? search.denied : null;

  const visibleLabs = ctx.isPlatformAdmin ? await allLabs() : ctx.adminLabs;
  const labIds = visibleLabs.map((l) => l.labId);
  const [counts, recent, labs] = await Promise.all([
    countsForLabs(labIds),
    recentAudit(ctx.isPlatformAdmin ? null : labIds),
    labsOverview(labIds),
  ]);

  // Platform-wide figures (every registered account, every laboratory's
  // billing, Stripe revenue) are for a system administrator only — a
  // laboratory admin manages their own lab, not the whole deployment's
  // membership or pricing.
  let revenue: BillingDashboardData | null = null;
  let memberStats: {
    totalMembers: number;
    payingMembers: number;
    users: MemberPaymentUser[];
  } | null = null;
  let planPrices: Awaited<ReturnType<typeof getPlanPrices>> | null = null;
  let roleCounts: { admins: number; users: number } | null = null;
  if (ctx.isPlatformAdmin) {
    [revenue, memberStats, planPrices, roleCounts] = await Promise.all([
      loadBillingDashboard(OVERVIEW_RANGE_DAYS, OVERVIEW_GRANULARITY).then((r) => r.data ?? null),
      memberPaymentOverview(),
      getPlanPrices(),
      platformRoleCounts(),
    ]);
  }

  const adminSections = (NAV_GROUPS.find((g) => g.id === "admin")?.items ?? []).filter(
    (item) => item.href !== "/admin" && (!item.platformOnly || ctx.isPlatformAdmin),
  );

  const payingRate = memberStats && memberStats.totalMembers > 0
    ? Math.round((memberStats.payingMembers / memberStats.totalMembers) * 100)
    : 0;

  const planBars: PriceBar[] = planPrices
    ? PLAN_LIST.map((p) => {
        const offer = planOffers(planPrices, { mockCheckout: isMockCheckoutAllowed() })[p.id];
        return {
          label: p.name,
          amountJpy: offer.amountJpy,
          unit: `${formatBillingPeriod(p.billingInterval)}額`,
          highlighted: p.popular,
        };
      })
    : [];
  const creditBars: PriceBar[] = PEER_REVIEW_CREDIT_PACKS.map((p) => ({
    label: p.name,
    amountJpy: p.amountJpy,
    unit: p.billingInterval === "month" ? "月額（無制限）" : `${p.credits}回分`,
    highlighted: Boolean(p.popular),
  }));

  return (
    <div className="flex flex-col gap-4">
      {denied === "platform" && (
        <Callout tone="warn" title="システム管理者専用">
          そのセクションはシステム管理者のみ利用できます。研究室の管理はこちらから行えます。
        </Callout>
      )}

      {/* ------------------------------------------------------------ 会員概況 */}
      {memberStats && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-ink-2">会員概況</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card
              title="登録会員・支払い実績"
              subtitle="Stripeでの決済が確認できたアカウントを「支払い実績あり」として数えています。累計支払いは返金差引後です。"
            >
              <div className="grid grid-cols-3 gap-3">
                <StatTile label="総登録会員数" value={memberStats.totalMembers} />
                <StatTile label="支払い実績あり" value={memberStats.payingMembers} tone="accent" />
                <StatTile label="支払い率" value={`${payingRate}%`} />
              </div>
              {roleCounts && (
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-4">
                  <StatTile label="システム管理者" value={roleCounts.admins} />
                  <StatTile label="一般ユーザー" value={roleCounts.users} />
                </div>
              )}
              <div className="mt-4 border-t border-[var(--border)] pt-3">
                <MemberUsersPanel users={memberStats.users} />
              </div>
            </Card>
            <Card title="内訳（支払い実績の有無）">
              <MemberPaymentDonut total={memberStats.totalMembers} paying={memberStats.payingMembers} />
              <div className="mt-5 border-t border-[var(--border)] pt-4">
                <SignupTrendChart signedUpAts={memberStats.users.map((u) => u.signedUpAt)} />
              </div>
            </Card>
          </div>
        </section>
      )}

      {/* --------------------------------------------------------------- 料金 */}
      {planPrices && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-ink-2">料金</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card title="研究室プラン" subtitle="現在Stripeに設定されている金額（未設定の場合はカタログの既定額）。">
              <PricingBarChart bars={planBars} />
            </Card>
            <Card title="AI査読 従量課金パック">
              <PricingBarChart bars={creditBars} />
            </Card>
          </div>
          {revenue && <AdminRevenuePanel initial={revenue} />}
        </section>
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

      {/* ------------------------------------------------------ 研究室・実験概況 */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink-2">研究室・実験概況</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          <Card title="概況">
            <div className="grid grid-cols-2 gap-3">
              <StatTile label="研究室" value={visibleLabs.length} />
              <StatTile label="実験" value={counts.experiments} />
              <StatTile label="メンバー" value={counts.members} />
              <StatTile label="テンプレート" value={counts.notebook_templates} />
              <StatTile label="データセット" value={counts.datasets} />
              <StatTile label="解析" value={counts.analyses} />
            </div>
          </Card>
          <Card title="研究室ごとの詳細" subtitle="作成者・メンバー数・実験数・プランを一覧できます。">
            {labs.length === 0 ? (
              <EmptyState title="表示できる研究室がありません" />
            ) : (
              <DataTable
                maxHeight="360px"
                headers={["研究室", "作成者", "メンバー", "実験", "プラン", "作成日"]}
                align={["left", "left", "right", "right", "left", "left"]}
                rows={labs.map((l) => [
                  // Explicit max-width, not `truncate` + `min-w-0` alone: a
                  // plain <table> sizes columns to fit content by default, so
                  // without a real width bound here a long description would
                  // stretch this cell (and the whole table) rather than
                  // ellipsize, exactly the "only one column visible" bug this
                  // replaced.
                  <div key="name" style={{ maxWidth: 220 }}>
                    <p className="truncate font-medium text-ink">{l.name}</p>
                    {l.description && (
                      <p className="truncate text-[11px] text-ink-3" title={l.description}>{l.description}</p>
                    )}
                  </div>,
                  <div key="owner" style={{ maxWidth: 180 }}>
                    <p className="truncate">{l.ownerName}</p>
                    <p className="truncate text-[11px] text-ink-3">{l.ownerEmail}</p>
                  </div>,
                  l.memberCount,
                  l.experimentCount,
                  <div key="plan" className="flex flex-col items-start gap-1" style={{ maxWidth: 140 }}>
                    <span className="truncate">{PLAN_LIST.find((p) => p.id === l.plan)?.name ?? l.plan}</span>
                    <Badge tone={STATUS_LABELS[l.status as keyof typeof STATUS_LABELS]?.tone ?? "neutral"}>
                      {STATUS_LABELS[l.status as keyof typeof STATUS_LABELS]?.ja ?? l.status}
                    </Badge>
                  </div>,
                  <span key="date" className="whitespace-nowrap">
                    {new Date(l.createdAt).toLocaleDateString("ja-JP")}
                  </span>,
                ])}
              />
            )}
          </Card>
        </div>
      </section>

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
