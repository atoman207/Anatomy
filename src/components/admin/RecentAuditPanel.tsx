"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { Button, EmptyState, cx } from "@/components/ui";

export interface RecentAuditRow {
  id: string | number;
  action: string;
  created_at: string;
  lab_id: string | null;
}

const PREVIEW = 5;

function AuditTable({ rows }: { rows: RecentAuditRow[] }) {
  return (
    <div className="scroll-x rounded-lg border border-line">
      <table className="w-full border-collapse text-xs">
        <thead className="bg-surface-2">
          <tr>
            {["操作", "日時"].map((h) => (
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
          {rows.map((row) => (
            <tr key={row.id} className="even:bg-surface-2/40">
              <td className="border-b border-line px-2.5 py-2">
                <span className="font-mono text-ink" title={row.action}>{row.action}</span>
              </td>
              <td className="border-b border-line px-2.5 py-2 whitespace-nowrap text-ink-3">
                {new Date(row.created_at).toLocaleString("ja-JP")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Preview of the 5 newest audit rows (same source as /admin/audit).
 * もっと見る opens the loaded set; the modal links to the full audit tab.
 */
export function RecentAuditPanel({ rows }: { rows: RecentAuditRow[] }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  const sorted = useMemo(
    () => [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    [rows],
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
          直近{PREVIEW}件を表示
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
        <EmptyState title="まだ操作は記録されていません" />
      ) : (
        <AuditTable rows={preview} />
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
              "flex max-h-[min(85vh,720px)] w-full max-w-3xl flex-col overflow-hidden",
              "rounded-lg border border-line bg-surface-1 shadow-[var(--shadow-md)]",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 id={titleId} className="font-serif text-base font-semibold text-ink">
                  監査ログ
                </h2>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  直近 {sorted.length} 件 · 自動追記 · 編集・削除不可
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href="/admin/audit"
                  className="text-[13px] font-medium text-accent underline underline-offset-2"
                >
                  監査ログタブを開く
                </Link>
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)} aria-label="閉じる">
                  閉じる
                </Button>
              </div>
            </header>
            <div className="shell-scroll flex-1 overflow-auto px-5 py-4">
              {sorted.length === 0 ? (
                <EmptyState title="まだ操作は記録されていません" />
              ) : (
                <AuditTable rows={sorted} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
