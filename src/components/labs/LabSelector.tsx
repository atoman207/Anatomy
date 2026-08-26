"use client";

import Link from "next/link";
import { cx } from "@/components/ui";

/**
 * Switches which laboratory `/labs` is showing, via the URL.
 *
 * Owned labs (created by this account) and invited labs (this account was
 * added to someone else's) use two different color families - blue for
 * owned, violet for invited - crossed with the existing selected/unselected
 * treatment, so at a glance the tab list also answers "which of these did I
 * actually create?" A small "招待" tag backs up the color for anyone who
 * can't rely on color alone.
 */
export function LabSelector({
  labs,
  current,
}: {
  labs: { id: string; name: string; experimentCount: number; isOwner: boolean }[];
  current: string;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="研究室">
      {labs.map((l) => {
        const selected = l.id === current;
        return (
          <Link
            key={l.id}
            href={`/labs?lab=${encodeURIComponent(l.id)}`}
            role="tab"
            aria-selected={selected}
            className={cx(
              "rounded-md border px-3 py-2 text-[13px] font-medium transition-colors",
              l.isOwner
                ? selected
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line bg-surface-1 text-ink-2 hover:border-accent hover:text-accent"
                : selected
                  ? "border-violet-400 bg-violet-50 text-violet-700 dark:border-violet-500 dark:bg-violet-500/15 dark:text-violet-300"
                  : "border-violet-200 bg-violet-50/60 text-violet-700/80 hover:border-violet-400 hover:text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300/80",
            )}
          >
            {l.name}
            <span className="ml-1.5 text-[11px] font-normal opacity-70">({l.experimentCount})</span>
            {!l.isOwner && (
              <span className="ml-1.5 rounded-full bg-violet-200/70 px-1.5 py-0.5 text-[9px] font-semibold text-violet-800 dark:bg-violet-500/25 dark:text-violet-200">
                招待
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
