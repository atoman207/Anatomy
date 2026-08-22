import Link from "next/link";
import { PageHeader } from "@/components/shell/PageHeader";
import { Callout } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { PlanPriceEditor } from "@/components/admin/PlanPriceEditor";
import {
  getPlanPrices, planPricesTableReady, type PlanPrice,
} from "@/lib/billing/priceStore";
import { isStripeConfigured, stripeConfigStatus } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

/**
 * What each plan costs.
 *
 * Platform-admin only - this sets what every customer is charged. The prices
 * live in `plan_prices` rather than in environment variables so a change is
 * an administrative action that takes effect immediately on every deployment
 * reading the same database, instead of an edit-and-redeploy.
 *
 * Separate from `/admin/billing`, which reports on money that has already
 * moved. Setting a price is a rare, deliberate act; watching payments arrive
 * is a daily one, and putting a form that re-prices the product at the bottom
 * of a page somebody refreshes all day is asking for an accident.
 */
export default async function AdminPlanPricesPage() {
  await requirePlatformAdmin("/admin/billing/prices");

  const [priceMap, tableReady] = await Promise.all([
    getPlanPrices(),
    planPricesTableReady(),
  ]);
  const status = stripeConfigStatus();
  const prices = Object.values(priceMap).filter((p): p is PlanPrice => Boolean(p));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="料金設定"
        description="各プランの月額と、Stripe 上の価格を管理します。変更は再デプロイなしで反映されます。"
        meta={status.testMode ? <span className="text-[12px] text-warn">Stripe テストモード</span> : null}
        actions={
          <Link
            href="/admin/billing"
            className="text-[13px] text-accent underline underline-offset-2"
          >
            決済ダッシュボードへ
          </Link>
        }
      />

      {!tableReady && (
        <Callout tone="danger" title="plan_prices テーブルがまだありません">
          <code className="font-mono text-[12px]">supabase/migrations/all.sql</code>{" "}
          の末尾「Plan prices」の節を Supabase の SQL エディタで実行してください。
          実行するまで価格を保存できず、下の表示は環境変数
          （<code className="font-mono text-[12px]">STRIPE_PRICE_*</code>）
          のみに基づきます。
        </Callout>
      )}

      {status.missing.length > 0 && (
        <Callout tone="danger" title="Stripe の設定が未完了です">
          未設定:{" "}
          <code className="font-mono text-[12px]">{status.missing.join(", ")}</code>
        </Callout>
      )}

      <PlanPriceEditor prices={prices} stripeConfigured={isStripeConfigured()} />
    </div>
  );
}
