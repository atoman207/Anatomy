"use client";

import Link from "next/link";
import { useWorkspace } from "@/components/workspace";

/**
 * "What have I already chosen" bar, shown at the top of every step from 2
 * onward so a researcher never has to scroll back up (or hunt through the
 * sidebar) to check which lab/experiment/reagents/template a later step is
 * actually acting on. Each field is only shown once it is meaningful for the
 * step being viewed - step 2 has no template yet, for instance - and every
 * field links back to the step that set it via the same `/record?step=N`
 * links the sidebar already uses, so "go back and correct it" is just a
 * normal navigation, not a special-cased action.
 */
export function SelectionSummary({ upTo }: { upTo: 2 | 3 | 4 | 5 }) {
  const ws = useWorkspace();

  const items: { label: string; value: string; step: number }[] = [];

  items.push({
    label: "実験",
    value: ws.experimentLabel ?? "未選択",
    step: 1,
  });

  if (upTo >= 3) {
    items.push({
      label: "試薬",
      value: ws.selectedReagentIds.length > 0 ? `${ws.selectedReagentIds.length} 件選択中` : "未選択",
      step: 2,
    });
  }

  if (upTo >= 4) {
    items.push({
      label: "テンプレート",
      value: ws.templateLabel ?? "未選択",
      step: 3,
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-line bg-surface-2 px-4 py-2.5 text-[12px]">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span className="text-ink-3">{it.label}:</span>
          <span className="font-medium text-ink">{it.value}</span>
          <Link href={`/record?step=${it.step}`} className="text-accent underline underline-offset-2">
            変更
          </Link>
        </span>
      ))}
    </div>
  );
}
