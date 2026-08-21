"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Callout, Card, Field, TextInput } from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import {
  formatJpy, MAX_REASONABLE_JPY, PAID_PLANS, STRIPE_MIN_JPY, type PlanId,
} from "@/lib/billing/plans";
import type { PlanPrice } from "@/lib/billing/priceResolution";
import { createPlanPrice, syncPlanPrice } from "@/lib/billing/priceActions";

/**
 * What each paid plan costs, and the control to change it.
 *
 * Changing a price creates a new Stripe Price rather than editing the old one
 * - Stripe Prices are immutable - so the card below is explicit that existing
 * subscribers keep their current price until they are moved, rather than
 * implying a change applies to everyone retroactively.
 */
export function PlanPriceEditor({
  prices, stripeConfigured,
}: {
  prices: PlanPrice[];
  stripeConfigured: boolean;
}) {
  const byPlan = new Map(prices.map((p) => [p.plan, p]));

  return (
    <div className="flex flex-col gap-4">
      {!stripeConfigured && (
        <Callout tone="warn" title="Stripe が未設定です">
          <code className="font-mono text-[12px]">STRIPE_SECRET_KEY</code>{" "}
          を設定するまで価格を作成できません。
        </Callout>
      )}

      {PAID_PLANS.map((plan) => (
        <PlanPriceCard
          key={plan.id}
          planId={plan.id}
          planName={plan.name}
          catalogueAmount={plan.amountJpy}
          current={byPlan.get(plan.id) ?? null}
          disabled={!stripeConfigured}
        />
      ))}

      <Card title="価格を変更したときの動作">
        <p className="text-[13px] leading-relaxed text-ink-2">
          Stripe の価格は作成後に金額を変更できない仕様のため、金額を変えると新しい価格が
          作成され、以降の新規申し込みはその価格で行われます。すでに契約中のお客様は、
          Stripe の請求ポータルまたはダッシュボードで移行するまで、契約時の価格のまま
          請求されます。値上げが既存の契約者へ自動的に適用されることはありません。
        </p>
      </Card>
    </div>
  );
}

function PlanPriceCard({
  planId, planName, catalogueAmount, current, disabled,
}: {
  planId: PlanId;
  planName: string;
  catalogueAmount: number;
  current: PlanPrice | null;
  disabled: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [amount, setAmount] = useState(String(current?.amountJpy ?? catalogueAmount));
  const [busy, setBusy] = useState<null | "create" | "sync">(null);

  const parsed = Number(amount);
  // The same two bounds `createPlanPrice` enforces. Checked here as well so a
  // mistyped extra digit is caught before a Price that charges 100x the
  // intended amount is created - Stripe Prices cannot be edited afterwards.
  const valid =
    Number.isInteger(parsed) && parsed >= STRIPE_MIN_JPY && parsed < MAX_REASONABLE_JPY;
  const unchanged = current?.amountJpy != null && parsed === current.amountJpy;

  async function create() {
    setBusy("create");
    try {
      const res = await createPlanPrice(planId, parsed);
      if (!res.ok) throw new Error(res.error ?? "価格を作成できませんでした。");
      toast(`${planName}プランの価格を ${formatJpy(parsed)} / 月にしました。`, { tone: "good" });
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "価格を作成できませんでした。", { tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  async function sync() {
    setBusy("sync");
    try {
      const res = await syncPlanPrice(planId);
      if (!res.ok) throw new Error(res.error ?? "同期できませんでした。");
      toast(`${planName}プランの価格を Stripe から取得しました。`, { tone: "good" });
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "同期できませんでした。", { tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      title={`${planName}プラン`}
      subtitle={
        current?.priceId
          ? `現在の価格: ${current.amountJpy != null ? `${formatJpy(current.amountJpy)} / 月` : "（Stripeから未取得）"}`
          : "価格が未作成のため、このプランはまだ購入できません。"
      }
      actions={
        current?.priceId ? (
          <Badge tone={current.source === "database" ? "good" : "neutral"}>
            {current.source === "database" ? "設定済み" : "環境変数"}
          </Badge>
        ) : (
          <Badge tone="warn">未設定</Badge>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {current?.priceId && (
          <p className="font-mono text-[11px] break-all text-ink-3">{current.priceId}</p>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <Field label="月額（円・税込）" className="min-w-[160px]">
            <TextInput
              type="number"
              inputMode="numeric"
              min={STRIPE_MIN_JPY}
              max={MAX_REASONABLE_JPY - 1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Button
            variant="primary"
            icon="save"
            disabled={disabled || busy !== null || !valid || unchanged}
            onClick={create}
            title={unchanged ? "現在の価格と同じです" : undefined}
          >
            {busy === "create"
              ? "作成中…"
              : current?.priceId
                ? "この金額に変更"
                : "この金額で作成"}
          </Button>
          {current?.priceId && (
            <Button
              variant="ghost"
              icon="refresh"
              disabled={disabled || busy !== null}
              onClick={sync}
            >
              {busy === "sync" ? "取得中…" : "Stripeから再取得"}
            </Button>
          )}
        </div>

        {!valid && (
          <p className="text-[12px] text-danger">
            {STRIPE_MIN_JPY} 円以上 {MAX_REASONABLE_JPY.toLocaleString("ja-JP")} 円未満の
            整数を入力してください。
          </p>
        )}
      </div>
    </Card>
  );
}
