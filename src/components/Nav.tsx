"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

const LINKS = [
  { href: "/", label: "ダッシュボード", en: "Dashboard" },
  { href: "/organize", label: "データ整理", en: "Organize" },
  { href: "/analyze", label: "統計・図", en: "Analyze" },
  { href: "/notebook", label: "実験ノート", en: "Notebook" },
  { href: "/experiments", label: "実験一覧", en: "Experiments" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface-1/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:px-6">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-base font-semibold tracking-tight text-ink">chondro</span>
          <span className="hidden text-[11px] text-ink-3 sm:inline">research workbench</span>
        </Link>
        <nav className="scroll-x flex items-center gap-1">
          {LINKS.map((l) => {
            const active =
              l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "bg-accent-soft text-accent"
                    : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                )}
              >
                {l.label}
                <span className="ml-1.5 hidden text-ink-3 lg:inline">{l.en}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
