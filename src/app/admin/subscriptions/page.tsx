import Link from "next/link";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, Callout, StatTile } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { LabSubscriptionsPanel } from "@/components/admin/LabSubscriptionsPanel";
import { listLabSubscriptions } from "@/lib/billing/adminSubscriptions";
import { stripeConfigStatus } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

/**
 * Contract management for every laboratory.
 *
 * The administrative counterpart to `/billing`. That page answers "what is my
 * laboratory on" and belongs to the owner paying for it; this one answers
 * "what is every laboratory on, and what do I need to do about it", which is
 * a different question with a different authority level. An administrator
 * should never have to sign in as an owner - or pick their own laboratory out
 * of a dropdown - to change somebody else's plan.
 */
export default async function AdminSubscriptionsPage() {
  await requirePlatformAdmin("/admin/subscriptions");

  const rows = await listLabSubscriptions();
  const status = stripeConfigStatus();

  const paid = rows.filter((r) => r.plan !== "free");
  const atRisk = rows.filter((r) => r.status === "past_due" || r.status === "unpaid");
  const grants = rows.filter((r) => r.manualGrant);
  const overLimit = rows.filter((r) => r.overLimit);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="契約管理"
        description="すべての研究室のプラン・支払い状態・使用量を一覧し、プラン変更・解約・同期をここから行えます。"
        meta={
          <>
            {status.testMode && <Badge tone="warn">Stripe テストモード</Badge>}
            {!status.testMode && status.configured && <Badge tone="good">本番モード</Badge>}
          </>
        }
        actions={
          <>
            <Link href="/admin/billing" className="text-[13px] text-accent underline underline-offset-2">
              決済ダッシュボード
            </Link>
            <Link href="/admin/billing/prices" className="text-[13px] text-accent underline underline-offset-2">
              料金設定
            </Link>
          </>
        }
      />

      {status.missing.length > 0 && (
        <Callout tone="warn" title="Stripe の設定が未完了です">
          未設定: <code className="font-mono text-[12px]">{status.missing.join(", ")}</code>
          。設定が完了するまで、プラン変更や同期は実行できません。
        </Callout>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="研究室" value={rows.length} />
        <StatTile label="有料プラン" value={paid.length} tone="accent" />
        <StatTile
          label="支払い遅延"
          value={atRisk.length}
          tone={atRisk.length > 0 ? "warn" : undefined}
        />
        <StatTile
          label="手動付与"
          value={grants.length}
          tone={grants.length > 0 ? "warn" : undefined}
          hint={grants.length > 0 ? "売上に計上されません" : undefined}
        />
      </div>

      {overLimit.length > 0 && (
        <Callout tone="warn" title={overLimit.length + " 件の研究室がプランの上限を超えています"}>
          既存のデータが削除されることはありませんが、新規追加はデータベース側で拒否されます。
          該当研究室: {overLimit.map((r) => r.labName).join("、")}
        </Callout>
      )}

      <LabSubscriptionsPanel rows={rows} testMode={status.testMode} />
    </div>
  );
}
