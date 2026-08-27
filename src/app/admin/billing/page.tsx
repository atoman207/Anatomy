import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, Callout } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { BillingDashboard } from "@/components/admin/BillingDashboard";
import { loadBillingDashboard } from "@/lib/billing/dashboardActions";
import { defaultGranularityFor } from "@/lib/billing/revenue";
import { stripeConfigStatus } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

const DEFAULT_RANGE_DAYS = 30;

/**
 * Payments, as they stand in Stripe right now.
 *
 * Platform-admin only: every customer's email address and every charge on the
 * account is on this page. The first snapshot is rendered on the server so
 * the page arrives with its figures already in it; the client then polls the
 * same action, which is what makes it a live view rather than a page somebody
 * has to keep reloading.
 *
 * Nothing here reads `lab_subscriptions` for a money figure. That table is a
 * webhook mirror kept for entitlement checks on the request path - accurate
 * enough to decide whether a button works, but an administrator asking what
 * the account took today is asking about Stripe, and should be told what
 * Stripe says.
 */
export default async function AdminBillingPage() {
  await requirePlatformAdmin("/admin/billing");

  const status = stripeConfigStatus();
  const snapshot = await loadBillingDashboard(
    DEFAULT_RANGE_DAYS,
    defaultGranularityFor(DEFAULT_RANGE_DAYS),
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="決済ダッシュボード"
        description="Stripe の売上・顧客・サブスクリプションを表示します。数字は Stripe から直接読み取っており、30秒ごとに更新されます。"
        meta={
          <>
            {status.testMode && <Badge tone="warn">Stripe テストモード</Badge>}
            {!status.testMode && status.configured && <Badge tone="good">本番モード</Badge>}
          </>
        }
        actions={
          <a
            href={"https://dashboard.stripe.com/" + (status.testMode ? "test/" : "") + "payments"}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-accent underline underline-offset-2"
          >
            Stripe ダッシュボード
          </a>
        }
      />

      {!snapshot.ok || !snapshot.data ? (
        <Callout tone="danger" title="決済データを読み込めませんでした">
          {snapshot.error ?? "しばらくしてから再度お試しください。"}
        </Callout>
      ) : (
        <BillingDashboard initial={snapshot.data} />
      )}
    </div>
  );
}
