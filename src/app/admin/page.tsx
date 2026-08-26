import { Callout, Card, StatTile } from "@/components/ui";
import { PageHeader } from "@/components/shell/PageHeader";
import { AdminRevenuePanel } from "@/components/admin/AdminRevenuePanel";
import { LabsDetailPanel } from "@/components/admin/LabsDetailPanel";
import { MemberPaymentDonut } from "@/components/admin/MemberPaymentDonut";
import { MemberUsersPanel, type MemberPaymentUser } from "@/components/admin/MemberUsersPanel";
import { RecentAuditPanel } from "@/components/admin/RecentAuditPanel";
import { SignupTrendChart } from "@/components/admin/SignupTrendChart";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminSupabase } from "@/lib/supabase/server";
import { loadBillingDashboard } from "@/lib/billing/dashboardActions";
import { listPayments } from "@/lib/billing/stripeAdmin";
import { type PlanId } from "@/lib/billing/plans";
import type { BillingDashboardData } from "@/lib/billing/dashboardTypes";

export const dynamic = "force-dynamic";

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
    "notebook_templates",
  ] as const;

  const out = { ...empty };
  await Promise.all(
    tables.map(async (t) => {
      const { count } = await admin
        .from(t)
        .select("lab_id", { count: "exact", head: true })
        .in("lab_id", labIds);
      out[t] = count ?? 0;
    }),
  );

  // Exact per-lab membership totals, same source as /admin/labs and /admin/members.
  // Summing those counts (not a single unbounded select) keeps the overview in
  // step with what each tab reports for every laboratory.
  let members = 0;
  await Promise.all(
    labIds.map(async (labId) => {
      const { count } = await admin
        .from("lab_members")
        .select("user_id", { count: "exact", head: true })
        .eq("lab_id", labId);
      members += count ?? 0;
    }),
  );
  out.members = members;
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

  // Dashboard 会員一覧 excludes platform administrators; totals must match that
  // roster (and the 「一般ユーザー」 figure on /admin/users), not every profile.
  const members = users.filter((u) => !u.isAdmin);
  const payingMembers = members.filter((u) => paidUserIds.has(u.id)).length;

  return {
    totalMembers: members.length,
    payingMembers,
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
 * Every visible laboratory with the same member / experiment counts the
 * /admin/labs and /admin/members tabs use (exact head counts per lab).
 */
async function labsOverview(labIds: string[]): Promise<LabOverviewRow[]> {
  if (labIds.length === 0) return [];
  const admin = createAdminSupabase();

  const [{ data: labs }, { data: subs }] = await Promise.all([
    admin.from("laboratories").select("id, name, description, owner_id, created_at").in("id", labIds),
    admin.from("lab_subscriptions").select("lab_id, plan, status").in("lab_id", labIds),
  ]);

  const ownerIds = [...new Set((labs ?? []).map((l) => l.owner_id))];
  const { data: owners } = ownerIds.length
    ? await admin.from("profiles").select("id, display_name, email").in("id", ownerIds)
    : { data: [] as { id: string; display_name: string | null; email: string | null }[] };
  const ownerById = new Map((owners ?? []).map((o) => [o.id, o]));
  const subByLab = new Map((subs ?? []).map((s) => [s.lab_id, s]));

  const rows: LabOverviewRow[] = [];
  for (const l of labs ?? []) {
    const [{ count: memberCount }, { count: experimentCount }] = await Promise.all([
      admin.from("lab_members").select("user_id", { count: "exact", head: true }).eq("lab_id", l.id),
      admin.from("experiments").select("id", { count: "exact", head: true }).eq("lab_id", l.id),
    ]);
    const owner = ownerById.get(l.owner_id);
    const sub = subByLab.get(l.id);
    rows.push({
      id: l.id,
      name: l.name,
      description: l.description,
      ownerName: owner?.display_name?.trim() || "—",
      ownerEmail: owner?.email ?? "—",
      createdAt: l.created_at,
      plan: (sub?.plan ?? "free") as PlanId,
      status: sub?.status ?? "active",
      memberCount: memberCount ?? 0,
      experimentCount: experimentCount ?? 0,
    });
  }

  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
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
  let roleCounts: { admins: number; users: number } | null = null;
  if (ctx.isPlatformAdmin) {
    [revenue, memberStats, roleCounts] = await Promise.all([
      loadBillingDashboard(OVERVIEW_RANGE_DAYS, OVERVIEW_GRANULARITY).then((r) => r.data ?? null),
      memberPaymentOverview(),
      platformRoleCounts(),
    ]);
  }

  const payingRate = memberStats && memberStats.totalMembers > 0
    ? Math.round((memberStats.payingMembers / memberStats.totalMembers) * 100)
    : 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="管理者ダッシュボード"
        description="各管理タブの内容を一覧できます。詳細の確認・編集は各タブで行います。"
      />
      {denied === "platform" && (
        <Callout tone="warn" title="システム管理者専用">
          そのセクションはシステム管理者のみ利用できます。研究室の管理はこちらから行えます。
        </Callout>
      )}

      {/* ------------------------------------------------------------ ユーザー */}
      {memberStats && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-ink-2">ユーザー</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card
              title="登録会員・支払い実績"
              subtitle="一般ユーザーのみ。システム管理者は除外。累計支払いは返金差引後です。"
            >
              <div className="grid grid-cols-3 gap-3">
                <StatTile label="一般ユーザー" value={memberStats.totalMembers} />
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
                <SignupTrendChart
                  signedUpAts={memberStats.users.filter((u) => !u.isAdmin).map((u) => u.signedUpAt)}
                />
              </div>
            </Card>
          </div>
        </section>
      )}

      {revenue && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-ink-2">決済</h2>
          <AdminRevenuePanel initial={revenue} />
        </section>
      )}

      {/* ------------------------------------------------------ 研究室・メンバー */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink-2">研究室</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          <Card title="概況" subtitle="研究室・メンバータブと同じ集計です。">
            <div className="grid grid-cols-2 gap-3">
              <StatTile label="研究室" value={visibleLabs.length} />
              <StatTile label="メンバー（所属合計）" value={counts.members} />
              <StatTile label="実験" value={counts.experiments} />
              <StatTile label="テンプレート" value={counts.notebook_templates} />
              <StatTile label="データセット" value={counts.datasets} />
              <StatTile label="解析" value={counts.analyses} />
            </div>
          </Card>
          <Card title="全研究室" subtitle={`${labs.length} 件`}>
            <LabsDetailPanel labs={labs} />
          </Card>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink-2">監査ログ</h2>
        <Card
          title="最近の操作"
          subtitle="自動的に追記されます。編集・削除はできません。"
        >
          <RecentAuditPanel rows={recent} />
        </Card>
      </section>
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
