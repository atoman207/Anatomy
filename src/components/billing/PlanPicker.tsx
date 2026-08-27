"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Callout, cx } from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import {
  formatBillingPeriod, formatJpy, PLAN_LIST, planAmountFor,
  type BillingInterval, type Plan, type PlanId,
} from "@/lib/billing/plans";
import type { PlanOfferMap } from "@/lib/billing/priceResolution";
import {
  cancelMockSubscription, openBillingPortal, startCheckout, syncSubscription,
} from "@/lib/billing/actions";

/**
 * The plan cards and the buttons that act on them.
 *
 * A client component because every action ends in a redirect - to Stripe
 * once an account is connected, to the in-app mock checkout until then -
 * which has to happen from the browser. It holds no entitlement logic of its
 * own - the current plan is decided on the server and passed in, and every
 * button calls a server action that re-checks the caller's authority before
 * doing anything.
 */

/** How long a toast that is about to be replaced by a page leave stays visible. */
const REDIRECT_TOAST_DELAY_MS = 700;

/** Default tab: month, so cards open on the monthly price only. */
const DEFAULT_INTERVAL: BillingInterval = "month";

export interface PlanPickerProps {
  labId: string;
  labName: string;
  currentPlan: PlanId;
  canManage: boolean;
  stripeConfigured: boolean;
  hasSubscription: boolean;
  checkoutOutcome: "success" | "cancel" | null;
  offers: PlanOfferMap;
}

/** Year / month options for a plan that supports both cadences. */
function dualBillingOptions(plan: Plan): { interval: BillingInterval; amount: number }[] {
  if (
    !plan.alternateSelectable
    || plan.alternateAmountJpy == null
    || !plan.alternateBillingInterval
  ) {
    return [{ interval: plan.billingInterval, amount: plan.amountJpy }];
  }
  const primary = { interval: plan.billingInterval, amount: plan.amountJpy };
  const alternate = {
    interval: plan.alternateBillingInterval,
    amount: plan.alternateAmountJpy,
  };
  // Tabs always appear as 年 | 月 left-to-right.
  return primary.interval === "year"
    ? [primary, alternate]
    : [alternate, primary];
}

export function PlanPicker({
  labId, labName, currentPlan, canManage, stripeConfigured, hasSubscription, checkoutOutcome,
  offers,
}: PlanPickerProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [intervals, setIntervals] = useState<Record<PlanId, BillingInterval>>({
    free: DEFAULT_INTERVAL,
    pro: DEFAULT_INTERVAL,
    team: DEFAULT_INTERVAL,
  });

  const synced = useRef(false);
  useEffect(() => {
    if (checkoutOutcome === "cancel") {
      toast("決済は完了していません。プランは変更されていません。", { tone: "info" });
    }
    if (checkoutOutcome !== "success" || synced.current || !canManage) return;
    synced.current = true;

    if (!stripeConfigured) {
      toast("お支払いが完了しました。プランを更新しました。", { tone: "good" });
      router.refresh();
      return;
    }

    void (async () => {
      setBusy("sync");
      try {
        const res = await syncSubscription(labId);
        if (res.ok) {
          toast("お支払いが完了しました。プランを更新しました。", { tone: "good" });
          router.refresh();
        } else {
          toast(
            "決済は完了しましたが、反映の確認に失敗しました。数秒後に「最新の状態を取得」をお試しください。",
            { tone: "warn" },
          );
        }
      } finally {
        setBusy(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutOutcome, labId, canManage, stripeConfigured, router]);

  function goTo(url: string, message: string) {
    toast(message, { tone: "info" });
    window.setTimeout(() => window.location.assign(url), REDIRECT_TOAST_DELAY_MS);
  }

  async function choose(plan: PlanId, interval?: BillingInterval) {
    setBusy(plan);
    try {
      const res = await startCheckout(labId, plan, interval);
      if (!res.ok || !res.data) {
        toast(res.error ?? "決済を開始できませんでした。", { tone: "danger" });
        return;
      }
      if (res.data.kind === "redirect") {
        goTo(res.data.url, "決済ページに移動します…");
        return;
      }
      toast("プランを変更しました。差額は日割りで次回請求に反映されます。", { tone: "good" });
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "決済を開始できませんでした。", { tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  async function portal() {
    setBusy("portal");
    try {
      const res = await openBillingPortal(labId);
      if (!res.ok || !res.data) {
        toast(res.error ?? "請求ポータルを開けませんでした。", { tone: "danger" });
        return;
      }
      goTo(res.data, "請求ポータルに移動します…");
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (!window.confirm("プランを解約します。よろしいですか？")) return;
    setBusy("cancel");
    const res = await cancelMockSubscription(labId);
    if (!res.ok) toast(res.error ?? "解約できませんでした。", { tone: "danger" });
    else {
      toast("解約しました。", { tone: "good" });
      router.refresh();
    }
    setBusy(null);
  }

  async function sync() {
    setBusy("sync");
    const res = await syncSubscription(labId);
    if (!res.ok) toast(res.error ?? "支払い状態を取得できませんでした。", { tone: "danger" });
    else {
      toast("最新の支払い状態を取得しました。", { tone: "good" });
      router.refresh();
    }
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 md:grid-cols-3">
        {PLAN_LIST.map((plan) => {
          const isCurrent = plan.id === currentPlan;
          const offer = offers[plan.id];
          const options = dualBillingOptions(plan);
          const dual = options.length > 1;
          const selectedInterval = dual
            ? intervals[plan.id]
            : plan.billingInterval;
          // `offer.amountJpy` is the Stripe/database-resolved price, and is
          // only ever known for the *primary* interval - `plan_prices` has
          // no interval column, so an administrator can only customize that
          // one cadence (see `resolveCheckoutPriceId`). Every plan here has
          // `alternateSelectable: true`, so `dual` is always true and the
          // card would otherwise show the static catalogue amount even on
          // the interval Stripe's actual price might differ from - showing
          // a price checkout would not actually charge.
          const displayAmount =
            selectedInterval === plan.billingInterval
              ? offer.amountJpy
              : planAmountFor(plan, selectedInterval);

          return (
            <section
              key={plan.id}
              className={cx(
                "relative flex flex-col overflow-hidden rounded-2xl border bg-surface-1 p-0 shadow-[0_8px_30px_-12px_rgba(26,54,93,0.18)] transition-shadow duration-200",
                isCurrent
                  ? "border-[var(--good)] ring-1 ring-[var(--good)]/30"
                  : plan.popular
                    ? "border-[var(--good)]/50"
                    : "border-line hover:shadow-[0_12px_36px_-14px_rgba(26,54,93,0.22)]",
              )}
            >
              <div
                className={cx(
                  "h-1.5 w-full",
                  isCurrent || plan.popular
                    ? "bg-[linear-gradient(90deg,var(--good)_0%,#34d399_100%)]"
                    : "bg-[linear-gradient(90deg,var(--accent)_0%,var(--accent-light)_100%)]",
                )}
                aria-hidden
              />

              <div className="flex flex-1 flex-col p-5 pt-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="font-serif text-lg font-semibold tracking-tight text-ink">
                    {plan.name}
                  </h3>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {plan.popular && <Badge tone="good">人気</Badge>}
                    {isCurrent && <Badge tone="good">現在のプラン</Badge>}
                  </div>
                </div>

                {dual && (
                  <div
                    role="tablist"
                    aria-label={`${plan.name}の支払い周期`}
                    className="mt-4 grid grid-cols-2 gap-1 rounded-full border border-line bg-surface-2/80 p-1"
                  >
                    {options.map((opt) => {
                      const selected = selectedInterval === opt.interval;
                      const label = opt.interval === "year" ? "年" : "月";
                      return (
                        <button
                          key={opt.interval}
                          type="button"
                          role="tab"
                          aria-selected={selected}
                          onClick={() =>
                            setIntervals((prev) => ({ ...prev, [plan.id]: opt.interval }))
                          }
                          className={cx(
                            "rounded-full px-2 py-1.5 text-[13px] font-semibold transition-colors duration-150",
                            selected
                              ? "bg-[var(--good)] text-white shadow-[0_2px_8px_rgba(5,150,105,0.35)]"
                              : "text-ink-3 hover:bg-surface-1 hover:text-ink",
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}

                <p className="mt-3 text-[13px] leading-snug text-ink-3">{plan.tagline}</p>
                {plan.popular && plan.popularReason && (
                  <p className="mt-2 rounded-lg bg-[var(--good-soft)]/70 px-3 py-2 text-[12px] leading-relaxed text-[var(--good)]">
                    {plan.popularReason}
                  </p>
                )}

                <p className="mt-5 flex items-baseline gap-1.5">
                  <span className="font-serif text-[32px] font-semibold leading-none tracking-tight text-ink">
                    {formatJpy(displayAmount)}
                  </span>
                  <span className="text-[13px] text-ink-3">
                    / {formatBillingPeriod(selectedInterval)}（税込）
                  </span>
                </p>

                <ul className="mt-5 flex flex-1 flex-col gap-2.5 text-[13px] leading-relaxed text-ink-2">
                  {plan.features.map((f) => (
                    <li key={f} className="flex gap-2.5">
                      <span
                        aria-hidden
                        className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[var(--good-soft)] text-[10px] font-bold text-[var(--good)]"
                      >
                        ✓
                      </span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-6">
                  {isCurrent ? (
                    <Button
                      disabled
                      className="w-full !border-[var(--good)]/40 !bg-[var(--good-soft)] !text-[var(--good)]"
                    >
                      利用中
                    </Button>
                  ) : !offer.purchasable ? (
                    <>
                      <Button variant="secondary" className="w-full" disabled>
                        準備中
                      </Button>
                      <p className="mt-2 text-[12px] leading-snug text-ink-3">
                        価格が未設定のため、現在はお申し込みいただけません。
                      </p>
                    </>
                  ) : (
                    <Button
                      variant="primary"
                      className={cx(
                        "w-full",
                        plan.popular &&
                          "!bg-[var(--good)] !shadow-[0_4px_14px_rgba(5,150,105,0.35)] hover:!bg-[#047857]",
                      )}
                      disabled={!canManage || busy !== null}
                      onClick={() => choose(plan.id, selectedInterval)}
                    >
                      {busy === plan.id ? "処理中…" : `${plan.name}にする`}
                    </Button>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          {hasSubscription && stripeConfigured && (
            <Button onClick={portal} disabled={busy !== null}>
              {busy === "portal" ? "開いています…" : "請求ポータル（解約・カード変更・領収書）"}
            </Button>
          )}
          {hasSubscription && !stripeConfigured && (
            <Button onClick={cancel} disabled={busy !== null}>
              {busy === "cancel" ? "処理中…" : "解約する"}
            </Button>
          )}
          {stripeConfigured && (
            <Button variant="ghost" onClick={sync} disabled={busy !== null}>
              {busy === "sync" ? "取得中…" : "最新の状態を取得"}
            </Button>
          )}
        </div>
      ) : (
        <Callout tone="info">
          プランを変更できるのは「{labName}」のオーナーのみです。オーナーに依頼してください。
        </Callout>
      )}
    </div>
  );
}
