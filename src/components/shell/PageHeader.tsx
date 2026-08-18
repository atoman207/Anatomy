import type { ReactNode } from "react";

/**
 * Page title block.
 *
 * The header bar already shows where you are, so this carries the sentence
 * that explains what the page is for — the part a first-time user needs and a
 * returning one can skim past.
 */
export function PageHeader({
  title, description, actions, meta,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-serif text-[22px] font-semibold leading-tight text-ink">{title}</h1>
        {description && (
          <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-ink-2">{description}</p>
        )}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
