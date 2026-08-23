"use client";

import Link from "next/link";
import { cx } from "@/components/ui";

/** Switches which laboratory `/labs` is showing, via the URL. */
export function LabSelector({
  labs,
  current,
}: {
  labs: { id: string; name: string; experimentCount: number }[];
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
              selected
                ? "border-accent bg-accent-soft text-accent"
                : "border-line bg-surface-1 text-ink-2 hover:border-accent hover:text-accent",
            )}
          >
            {l.name}
            <span className="ml-1.5 text-[11px] font-normal opacity-70">({l.experimentCount})</span>
          </Link>
        );
      })}
    </div>
  );
}
