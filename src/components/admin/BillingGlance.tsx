import Link from "next/link";
import { Badge, Callout, Card, StatTile } from "@/components/ui";
import { createAdminSupabase } from "@/lib/supabase/server";
import { PLANS, isPlanId, statusGrantsAccess, type PlanId } from "@/lib/billing/plans";
import { isSubscriptionStatus } from "@/lib/billing/plans";
import { stripeConfigStatus } from "@/lib/billing/stripe";

/**
 * Compact payment summary for the admin overview.
 *
 * Reads the local `lab_subscriptions` mirror rather than calling Stripe, so
 * the overview stays fast. Platform admins who need live revenue figures open
 * the full 決済ダッシュボード.
 */
export async function BillingGlance() {
  const status = stripeConfigStatus();
  const admin = createAdminSupabase();

  const { data: rows, error } = await admin
    .from("lab_subscriptions")
    .select("plan, status");

  if (error) {
    return (
      <Card
        title="決済"
        actions={<BillingLinks />}
      >
        <Callout tone="danger" title="購読データを読み込めませんでした">
          {error.message}
        </Callout>
      </Card>
    );
  }

  const byPlan: Record<PlanId, number> = { free: 0, pro: 0, team: 0 };
  let paidActive = 0;
  for (const row of rows ?? []) {
    const plan = isPlanId(row.plan) ? row.plan : "free";
    byPlan[plan] += 1;
    if (
      plan !== "free" &&
      isSubscriptionStatus(row.status) &&
      statusGrantsAccess(row.status)
    ) {
      paidActive += 1;
    }
  }

  return (
    <Card
      title="決済"
      subtitle="研究室ごとの契約状況（Webhook ミラー）"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {status.testMode && <Badge tone="warn">テストモード</Badge>}
          {!status.configured && <Badge tone="danger">未設定</Badge>}
          <BillingLinks />
        </div>
      }
    >
      {!status.configured && (
        <div className="mb-3">
          <Callout tone="warn" title="Stripe が未設定です">
            {status.missing.join("、")} を設定すると決済が有効になります。
          </Callout>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="有料・有効" value={paidActive} tone="accent" />
        <StatTile label={PLANS.free.name} value={byPlan.free} />
        <StatTile label={PLANS.pro.name} value={byPlan.pro} />
        <StatTile label={PLANS.team.name} value={byPlan.team} />
      </div>
    </Card>
  );
}

function BillingLinks() {
  return (
    <>
      <Link href="/admin/billing" className="text-xs text-accent underline">
        ダッシュボード
      </Link>
      <Link href="/admin/billing/prices" className="text-xs text-accent underline">
        料金設定
      </Link>
    </>
  );
}
