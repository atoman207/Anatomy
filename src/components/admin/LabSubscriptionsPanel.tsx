"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Field, Select, TextInput, cx } from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import {
  formatUsage, PLANS, PLAN_LIST, STATUS_LABELS, statusGrantsAccess, type PlanId,
} from "@/lib/billing/plans";
import {
  adminBillingPortal, adminCancelLabPlan, adminChangeLabPlan, adminSyncLab, grantPlanWithoutPayment,
} from "@/lib/billing/adminSubscriptionActions";
import type { LabSubscriptionRow } from "@/lib/billing/adminSubscriptions";

/**
 * Every laboratory's contract, with the controls to change it.
 *
 * This is the administrator's replacement for opening `/billing` and picking
 * a laboratory from a dropdown: one row per laboratory, every plan visible at
 * once, and the actions that change a contract on the row they affect.
 *
 * The controls stay collapsed until a row is opened. A table where every row
 * carries a plan dropdown and a cancel button invites the click nobody meant
 * to make - and these buttons move real money.
 */

type Filter = "all" | "paid" | "risk" | "grant";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "すべて" },
  { id: "paid", label: "有料" },
  { id: "risk", label: "要対応" },
  { id: "grant", label: "手動付与" },
];

export function LabSubscriptionsPanel({
  rows, testMode,
}: {
  rows: LabSubscriptionRow[];
  testMode: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "paid" && !(r.status && statusGrantsAccess(r.status) && r.stripeSubscriptionId)) {
        return false;
      }
      if (filter === "risk" && !(r.status === "past_due" || r.status === "unpaid" || r.overLimit)) {
        return false;
      }
      if (filter === "grant" && !r.manualGrant) return false;
      if (!q) return true;
      return (
        r.labName.toLowerCase().includes(q) ||
        (r.ownerEmail ?? "").toLowerCase().includes(q) ||
        (r.ownerName ?? "").toLowerCase().includes(q) ||
        (r.stripeCustomerId ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, query, filter]);

  return (
    <section className="rounded-lg border border-line bg-surface-1 shadow-[var(--shadow-sm)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-serif text-[17px] font-semibold text-ink">研究室ごとの契約</h2>
          <Badge tone="neutral">{visible.length}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cx(
                "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors duration-150",
                filter === f.id
                  ? "bg-accent text-accent-contrast"
                  : "border border-line bg-surface-1 text-ink-2 hover:border-accent hover:text-accent",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      <div className="border-b border-line px-4 py-2.5">
        <TextInput
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="研究室名・オーナー・Stripe顧客IDで検索"
          aria-label="研究室を検索"
          className="max-w-sm text-[13px]"
        />
      </div>

      <div className="scroll-x">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-surface-2">
              {["研究室", "オーナー", "プラン", "状態", "次回更新", "使用量", ""].map((h, i) => (
                <th
                  key={h + i}
                  className={cx(
                    "whitespace-nowrap border-b border-line px-3 py-2 font-semibold text-ink-2",
                    i === 6 ? "text-right" : "text-left",
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const status = r.status ? STATUS_LABELS[r.status] : null;
              const expanded = open === r.labId;
              return (
                // The fragment is what `map` returns, so the key belongs here
                // - keys on the rows inside it are invisible to React, and a
                // filter change would then reconcile rows onto the wrong lab.
                <Fragment key={r.labId}>
                  <tr className={cx("hover:bg-surface-2/60", expanded && "bg-surface-2/60")}>
                    <td className="border-b border-line px-3 py-2.5 font-medium text-ink">
                      {r.labName}
                      {r.overLimit && <Badge tone="warn">上限超過</Badge>}
                    </td>
                    <td className="border-b border-line px-3 py-2.5 text-ink-2">
                      <span className="block truncate">{r.ownerName ?? "—"}</span>
                      <span className="block truncate text-[11px] text-ink-3">{r.ownerEmail ?? ""}</span>
                    </td>
                    <td className="border-b border-line px-3 py-2.5">
                      <Badge tone={r.status && statusGrantsAccess(r.status) ? "accent" : "neutral"}>
                        {PLANS[r.plan].name}
                      </Badge>
                      {r.manualGrant && <Badge tone="warn">手動付与</Badge>}
                    </td>
                    <td className="border-b border-line px-3 py-2.5">
                      {status ? <Badge tone={status.tone}>{status.ja}</Badge> : <span className="text-ink-3">—</span>}
                      {r.cancelAtPeriodEnd && <Badge tone="warn">解約予定</Badge>}
                    </td>
                    <td className="whitespace-nowrap border-b border-line px-3 py-2.5 tabular-nums text-ink-2">
                      {r.currentPeriodEnd
                        ? new Date(r.currentPeriodEnd).toLocaleDateString("ja-JP")
                        : "—"}
                    </td>
                    <td className="whitespace-nowrap border-b border-line px-3 py-2.5 text-[12px] tabular-nums text-ink-2">
                      {formatUsage(r.members, PLANS[r.plan].limits.maxMembers)} 人 /{" "}
                      {formatUsage(r.experiments, PLANS[r.plan].limits.maxExperiments)} 実験
                    </td>
                    <td className="border-b border-line px-3 py-2.5 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setOpen(expanded ? null : r.labId)}
                        aria-expanded={expanded}
                      >
                        {expanded ? "閉じる" : "管理"}
                      </Button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={7} className="border-b border-line bg-surface-2/40 px-4 py-4">
                        <LabControls row={r} testMode={testMode} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>

        {visible.length === 0 && (
          <p className="px-4 py-10 text-center text-[13px] text-ink-3">
            {rows.length === 0 ? "研究室がまだありません。" : "条件に一致する研究室はありません。"}
          </p>
        )}
      </div>
    </section>
  );
}

/** The actions available on one laboratory's contract. */
function LabControls({ row, testMode }: { row: LabSubscriptionRow; testMode: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [plan, setPlan] = useState<PlanId>(row.plan);
  const [grantPlan, setGrantPlan] = useState<PlanId>("pro");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setBusy(key);
    try {
      const res = await fn();
      if (!res.ok) throw new Error(res.error ?? "実行できませんでした。");
      toast(done, { tone: "good" });
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "実行できませんでした。", { tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  async function openPortal() {
    setBusy("portal");
    try {
      const res = await adminBillingPortal(row.labId);
      if (!res.ok || !res.data) throw new Error(res.error ?? "請求ポータルを開けませんでした。");
      window.open(res.data, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast(e instanceof Error ? e.message : "請求ポータルを開けませんでした。", { tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  const stripeBase = "https://dashboard.stripe.com/" + (testMode ? "test/" : "");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="プランを変更" className="min-w-[150px]">
          <Select value={plan} onChange={(e) => setPlan(e.target.value as PlanId)} className="text-[13px]">
            {PLAN_LIST.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </Field>
        <Button
          size="sm"
          variant="primary"
          icon="save"
          disabled={busy !== null || plan === row.plan}
          onClick={() => {
            const label = PLANS[plan].name;
            if (!window.confirm(row.labName + " を" + label + "プランへ変更します。差額は日割りで請求されます。よろしいですか？")) return;
            void run("plan", () => adminChangeLabPlan(row.labId, plan), label + "プランに変更しました。");
          }}
        >
          {busy === "plan" ? "変更中…" : "適用"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null || !row.stripeSubscriptionId}
          onClick={() => {
            if (!window.confirm(row.labName + " の契約を解約し、期間終了時に未契約状態へ戻します。よろしいですか？")) return;
            void run("cancel", () => adminCancelLabPlan(row.labId), "解約を予約しました。");
          }}
        >
          {busy === "cancel" ? "解約中…" : "解約する"}
        </Button>

        <span aria-hidden className="hidden h-8 w-px bg-line sm:block" />

        <Button
          size="sm" variant="secondary" icon="refresh"
          disabled={busy !== null}
          onClick={() => void run("sync", () => adminSyncLab(row.labId), "Stripe から再同期しました。")}
        >
          {busy === "sync" ? "同期中…" : "Stripeから同期"}
        </Button>
        <Button size="sm" variant="secondary" disabled={busy !== null} onClick={openPortal}>
          {busy === "portal" ? "準備中…" : "請求ポータル"}
        </Button>
        {row.stripeCustomerId && !row.stripeCustomerId.startsWith("mock_") && (
          <a
            href={stripeBase + "customers/" + row.stripeCustomerId}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-accent underline underline-offset-2"
          >
            Stripe で開く
          </a>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-md border border-warn/30 bg-warn-soft/40 px-3 py-2.5">
        <div className="w-full">
          <p className="text-[12px] font-medium text-ink">手動付与（無償）</p>
          <p className="text-[11px] leading-snug text-ink-3">
            支払いを伴わずに有料プランを付与します。売上には計上されず、ダッシュボードでは
            「手動付与」として数えられます。
          </p>
        </div>
        <Field label="プラン" className="min-w-[120px]">
          <Select
            value={grantPlan}
            onChange={(e) => setGrantPlan(e.target.value as PlanId)}
            className="text-[13px]"
          >
            {PLAN_LIST.filter((p) => p.amountJpy > 0).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="理由（監査ログに記録）" className="min-w-[220px] flex-1">
          <TextInput
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例: 共同研究のため2026年度は無償"
            className="text-[13px]"
          />
        </Field>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null || reason.trim().length < 3}
          onClick={() => {
            if (!window.confirm(row.labName + " に " + PLANS[grantPlan].name + "プランを無償で付与します。請求は発生しません。よろしいですか？")) return;
            void run(
              "grant",
              () => grantPlanWithoutPayment(row.labId, grantPlan, reason),
              PLANS[grantPlan].name + "プランを付与しました。",
            );
          }}
        >
          {busy === "grant" ? "付与中…" : "無償で付与"}
        </Button>
      </div>

      <dl className="grid gap-x-6 gap-y-1 text-[11px] sm:grid-cols-2">
        <Detail label="Stripe 顧客" value={row.stripeCustomerId} />
        <Detail label="Stripe 契約" value={row.stripeSubscriptionId} />
        <Detail label="Stripe 価格" value={row.stripePriceId} />
        <Detail
          label="使用量"
          value={
            "メンバー " + row.members + " / 実験 " + row.experiments + " / データセット " + row.datasets
          }
        />
      </dl>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-ink-3">{label}</dt>
      <dd className="min-w-0 truncate font-mono text-ink-2">{value || "—"}</dd>
    </div>
  );
}
