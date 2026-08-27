import { Badge, Card, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/shell/PageHeader";
import { LabPicker } from "@/components/admin/LabPicker";
import { PlanPicker } from "@/components/billing/PlanPicker";
import { requireUser } from "@/lib/auth/guards";
import { formatUsage, STATUS_LABELS, withinLimit, type PlanId } from "@/lib/billing/plans";
import { isMockCheckoutAllowed, isStripeConfigured, stripeConfigStatus } from "@/lib/billing/stripe";
import { getPlanPrices } from "@/lib/billing/priceStore";
import { planOffers } from "@/lib/billing/priceResolution";
import { getLabEntitlement, getLabUsage } from "@/lib/billing/subscription";

export const dynamic = "force-dynamic";

/**
 * Plans and payment for one laboratory.
 *
 * The subscription belongs to the laboratory rather than to the person
 * looking at this page, so it opens on a laboratory - the first one the user
 * owns, since that is the one they can act on - and everything below is scoped
 * to it. Members of a lab they do not own still see the plan and the usage:
 * knowing why an AI button is refusing them is not privileged information.
 */
export default async function BillingPage(props: PageProps<"/billing">) {
  const ctx = await requireUser("/billing");
  const search = await props.searchParams;

  if (ctx.memberships.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="料金・支払い" description="ワークスペースごとのプランと支払いを管理します。" />
        <EmptyState title="ワークスペースを準備しています">
          ページを再読み込みしてください。個人用ワークスペースはログイン時に自動で作成されます。
        </EmptyState>
      </div>
    );
  }

  const labs = ctx.memberships.map((m) => ({ id: m.labId, name: m.labName }));
  const requested = typeof search.lab === "string" ? search.lab : null;
  const owned = ctx.memberships.filter((m) => m.role === "owner");
  const labId =
    labs.find((l) => l.id === requested)?.id ?? owned[0]?.labId ?? labs[0].id;
  const lab = labs.find((l) => l.id === labId)!;
  const membership = ctx.memberships.find((m) => m.labId === labId);
  const canManage = membership?.role === "owner" || ctx.isPlatformAdmin;

  const [entitlement, usage, prices] = await Promise.all([
    getLabEntitlement(labId),
    getLabUsage(labId),
    getPlanPrices(),
  ]);

  const stripeStatus = stripeConfigStatus();
  // The amounts on the cards are the ones Stripe would actually charge, not
  // the catalogue defaults - see `planOffers`.
  const offers = planOffers(prices, {
    mockCheckout: isMockCheckoutAllowed(),
    stripeConfigured: isStripeConfigured(),
  });

  const checkoutOutcome =
    search.checkout === "success" ? "success" :
    search.checkout === "cancel" ? "cancel" : null;

  const statusLabel = entitlement.status ? STATUS_LABELS[entitlement.status] : null;
  const renewal = entitlement.currentPeriodEnd
    ? new Date(entitlement.currentPeriodEnd).toLocaleDateString("ja-JP")
    : null;

  const limits = entitlement.plan.limits;
  const rows: { label: string; used: number; limit: number | null }[] = [
    { label: "研究室（オーナー）", used: owned.length, limit: limits.maxLabs },
    { label: "メンバー", used: usage.members, limit: limits.maxMembers },
    { label: "実験", used: usage.experiments, limit: limits.maxExperiments },
    { label: "データセット", used: usage.datasets, limit: limits.maxDatasets },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="料金・支払い"
        description="プランは研究室ごとの契約です。オーナーが支払うと、その研究室のメンバー全員が対象になります。"
        meta={
          <>
            <Badge tone="accent">{entitlement.plan.name}プラン</Badge>
            {statusLabel && <Badge tone={statusLabel.tone}>{statusLabel.ja}</Badge>}
            {stripeStatus.testMode && <Badge tone="warn">Stripe テストモード</Badge>}
          </>
        }
      />

      {labs.length > 1 && <LabPicker labs={labs} current={labId} basePath="/billing" />}

      <Card
        title={`現在のご契約 — ${lab.name}`}
        subtitle={
          entitlement.cancelAtPeriodEnd && renewal
            ? `${renewal} に解約予定です。それまでは現在のプランをご利用いただけます。`
            : renewal
              ? `次回更新日: ${renewal}`
              : "有料プランは未契約です。"
        }
      >
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {rows.map((row) => {
            const over = !withinLimit(row.used, row.limit);
            return (
              <div key={row.label} className="rounded-md border border-line px-4 py-3">
                <dt className="text-[12px] text-ink-3">{row.label}</dt>
                <dd className="mt-1 flex items-center gap-2">
                  <span className="font-serif text-[18px] font-semibold text-ink">
                    {formatUsage(row.used, row.limit)}
                  </span>
                  {over && <Badge tone="warn">上限</Badge>}
                </dd>
              </div>
            );
          })}
        </dl>
        <p className="mt-4 text-[13px] leading-relaxed text-ink-2">
          AI機能（音声の文字起こし・構造化、論文の要約と検索式の自動生成）:{" "}
          {entitlement.aiEnabled ? (
            <span className="text-good">利用できます</span>
          ) : (
            <span className="text-warn">個人研究者プラン以上のご契約が必要です</span>
          )}
          {" / "}
          AI画像生成:{" "}
          {entitlement.aiImageEnabled ? (
            <span className="text-good">利用できます</span>
          ) : (
            <span className="text-warn">利用できません</span>
          )}
        </p>
      </Card>

      <PlanPicker
        labId={labId}
        labName={lab.name}
        currentPlan={entitlement.planId as PlanId}
        canManage={canManage}
        stripeConfigured={stripeStatus.configured}
        hasSubscription={entitlement.hasStripeSubscription}
        checkoutOutcome={checkoutOutcome}
        offers={offers}
      />

      <Card title="上限に達したときの動作">
        <p className="text-[13px] leading-relaxed text-ink-2">
          メンバー・実験・データセットの上限はデータベース側で判定しています。上限を超える
          追加はブラウザからの操作でも管理画面からの操作でも同じように拒否され、すでに保存
          済みのデータが削除されることはありません。プランを下げた場合も、既存のデータはそ
          のまま残り、新規追加のみが制限されます。
        </p>
      </Card>
    </div>
  );
}
