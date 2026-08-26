"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { Badge, Button, EmptyState, cx } from "@/components/ui";
import { PLANS, STATUS_LABELS, type PlanId } from "@/lib/billing/plans";
import type { SubscriptionStatus } from "@/lib/billing/plans";

export interface LabDetailRow {
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

const PREVIEW = 5;

function formatCreated(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ja-JP");
  } catch {
    return "—";
  }
}

/** Same plan / status cells as /admin/labs. */
function PlanCell({ plan, status }: { plan: PlanId; status: string }) {
  const planName = PLANS[plan]?.name ?? plan;
  const meta = STATUS_LABELS[status as SubscriptionStatus];
  return (
    <span className="flex flex-nowrap items-center gap-1.5">
      <Badge tone={planName === "個人研究者" ? "neutral" : "accent"}>{planName}</Badge>
      {status && status !== "active" && meta && (
        <Badge tone={meta.tone}>{meta.ja}</Badge>
      )}
    </span>
  );
}

function LabsTable({ labs }: { labs: LabDetailRow[] }) {
  return (
    <div className="scroll-x rounded-lg border border-line">
      <table className="w-full border-collapse text-xs">
        <thead className="bg-surface-2">
          <tr>
            {["名称", "オーナー", "プラン", "メンバー", "実験", "作成日"].map((h) => (
              <th
                key={h}
                className="whitespace-nowrap border-b border-line px-2.5 py-2 text-left font-semibold text-ink-2"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labs.map((lab) => (
            <tr key={lab.id} className="even:bg-surface-2/40">
              <td className="max-w-[14rem] border-b border-line px-2.5 py-2">
                <p className="truncate font-medium text-ink" title={lab.name}>{lab.name}</p>
                {lab.description && (
                  <p className="truncate text-[11px] text-ink-3" title={lab.description}>
                    {lab.description}
                  </p>
                )}
              </td>
              <td className="max-w-[16rem] border-b border-line px-2.5 py-2">
                <p className="truncate font-mono text-ink-2" title={lab.ownerEmail}>
                  {lab.ownerEmail}
                </p>
              </td>
              <td className="border-b border-line px-2.5 py-2 whitespace-nowrap">
                <PlanCell plan={lab.plan} status={lab.status} />
              </td>
              <td className="border-b border-line px-2.5 py-2 text-right tabular-nums text-ink">
                {lab.memberCount}
              </td>
              <td className="border-b border-line px-2.5 py-2 text-right tabular-nums text-ink">
                {lab.experimentCount}
              </td>
              <td className="border-b border-line px-2.5 py-2 whitespace-nowrap text-ink-3">
                {formatCreated(lab.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Preview of the 5 newest laboratories using the same columns and counts as
 * /admin/labs. もっと見る opens the full list; the modal links to the tab.
 */
export function LabsDetailPanel({ labs }: { labs: LabDetailRow[] }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  const sorted = useMemo(
    () => [...labs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [labs],
  );
  const preview = useMemo(() => sorted.slice(0, PREVIEW), [sorted]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] font-medium text-ink-3">
          全{sorted.length} 件 · 直近{PREVIEW}件を表示
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="btn-see-more"
          onClick={() => setOpen(true)}
        >
          もっと見る
          <span className="btn-see-more-arrow" aria-hidden>
            →
          </span>
        </Button>
      </div>

      {preview.length === 0 ? (
        <EmptyState title="表示できる研究室がありません" />
      ) : (
        <LabsTable labs={preview} />
      )}

      {open && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 px-4"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className={cx(
              "flex max-h-[min(85vh,720px)] w-full max-w-6xl flex-col overflow-hidden",
              "rounded-lg border border-line bg-surface-1 shadow-[var(--shadow-md)]",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 id={titleId} className="font-serif text-base font-semibold text-ink">
                  研究室
                </h2>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  全{sorted.length} 件 · メンバー数は各研究室のメンバータブと同じ集計です
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href="/admin/labs"
                  className="text-[13px] font-medium text-accent underline underline-offset-2"
                >
                  研究室タブを開く
                </Link>
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)} aria-label="閉じる">
                  閉じる
                </Button>
              </div>
            </header>
            <div className="shell-scroll flex-1 overflow-auto px-5 py-4">
              {sorted.length === 0 ? (
                <EmptyState title="表示できる研究室がありません" />
              ) : (
                <LabsTable labs={sorted} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
