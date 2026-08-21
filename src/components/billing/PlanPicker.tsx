"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Callout, cx } from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import {
  formatJpy, PLAN_LIST, type PlanId,
} from "@/lib/billing/plans";
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

export interface PlanPickerProps {
  labId: string;
  labName: string;
  /** The plan in force right now. */
  currentPlan: PlanId;
  /** True when the signed-in user may change this laboratory's plan. */
  canManage: boolean;
  /** True once a Stripe account is connected; false runs the mock checkout instead. */
  stripeConfigured: boolean;
  /** True once a subscription (real or mock) exists, so cancelling is worth offering. */
  hasSubscription: boolean;
  /** `success` or `cancel`, when checkout has just sent the browser back. */
  checkoutOutcome: "success" | "cancel" | null;
}

export function PlanPicker({
  labId, labName, currentPlan, canManage, stripeConfigured, hasSubscription, checkoutOutcome,
}: PlanPickerProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  /*
   * The browser returns here before Stripe's webhook necessarily has. One
   * sync pulls the subscription straight from Stripe so the page shows the
   * new plan immediately; the webhook remains the authoritative path, and
   * this is idempotent with it. Without Stripe connected there is nothing to
   * sync - the mock checkout already wrote the final state itself - so this
   * only refreshes. The ref keeps React's development double-effect from
   * firing it twice.
   */
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

    // Nested so the immediate setBusy("sync") below is not a direct
    // synchronous call in the effect body itself, matching the pattern
    // AppShell's own identity-refresh effect uses for the same reason.
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

  /** Every redirect-away action shows what is about to happen, then leaves. */
  function goTo(url: string, message: string) {
    toast(message, { tone: "info" });
    window.setTimeout(() => window.location.assign(url), REDIRECT_TOAST_DELAY_MS);
  }

  async function choose(plan: PlanId) {
    setBusy(plan);
    try {
      const res = await startCheckout(labId, plan);
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
    if (!window.confirm("プランを解約し、フリープランに戻します。よろしいですか？")) return;
    setBusy("cancel");
    const res = await cancelMockSubscription(labId);
    if (!res.ok) toast(res.error ?? "解約できませんでした。", { tone: "danger" });
    else {
      toast("解約しました。フリープランに戻りました。", { tone: "good" });
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

  const downgrade = stripeConfigured ? portal : cancel;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        {PLAN_LIST.map((plan) => {
          const isCurrent = plan.id === currentPlan;
          const paid = plan.amountJpy > 0;
          return (
            <section
              key={plan.id}
              className={cx(
                "flex flex-col rounded-lg border bg-surface-1 p-5",
                isCurrent ? "border-accent shadow-[var(--shadow-sm)]" : "border-line",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-serif text-base font-semibold text-ink">{plan.name}</h3>
                {isCurrent && <Badge tone="accent">現在のプラン</Badge>}
              </div>
              <p className="mt-1 text-[13px] text-ink-3">{plan.tagline}</p>

              <p className="mt-4 flex items-baseline gap-1">
                <span className="font-serif text-[28px] font-semibold text-ink">
                  {plan.amountJpy === 0 ? "無料" : formatJpy(plan.amountJpy)}
                </span>
                {paid && <span className="text-[13px] text-ink-3">/ 月（税込）</span>}
              </p>

              <ul className="mt-4 flex flex-1 flex-col gap-2 text-[13px] leading-relaxed text-ink-2">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span aria-hidden className="text-accent">・</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-5">
                {isCurrent ? (
                  <Button disabled className="w-full">利用中</Button>
                ) : !paid ? (
                  <Button
                    variant="secondary"
                    className="w-full"
                    disabled={!canManage || busy !== null || !hasSubscription}
                    onClick={downgrade}
                  >
                    ダウングレードする
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    className="w-full"
                    disabled={!canManage || busy !== null}
                    onClick={() => choose(plan.id)}
                  >
                    {busy === plan.id ? "処理中…" : `${plan.name}にする`}
                  </Button>
                )}
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
