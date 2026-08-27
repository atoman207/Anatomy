"use client";

import { useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui";

/**
 * Centered modal for previewing an image or rendered Markdown block.
 * Click the backdrop or press Escape to dismiss.
 */
export function MediaPreviewModal({
  title, onClose, children, actions,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : "プレビュー"}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 px-4 py-8"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-line bg-surface-1 shadow-[var(--shadow-md)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="min-w-0 truncate font-serif text-base font-semibold text-ink">{title}</h2>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <Button
              size="sm"
              variant="ghost"
              icon="x"
              iconOnly
              aria-label="閉じる"
              title="閉じる"
              onClick={onClose}
            />
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
      </div>
    </div>
  );
}
