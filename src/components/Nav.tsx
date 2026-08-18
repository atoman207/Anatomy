"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";
import { UserMenu } from "./UserMenu";

const LINKS = [
  { href: "/", label: "ダッシュボード" },
  { href: "/organize", label: "データ整理" },
  { href: "/analyze", label: "統計・図" },
  { href: "/voice", label: "音声メモ" },
  { href: "/notebook", label: "実験ノート" },
  { href: "/literature", label: "論文検索" },
  { href: "/experiments", label: "実験一覧" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface-1 shadow-[var(--shadow-sm)]">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center transition-opacity hover:opacity-80">
          <Image
            src="/LOGO.png"
            alt="ロゴ"
            width={60}
            height={60}
            className="h-[60px] w-[60px] rounded-lg object-contain"
            priority
          />
        </Link>
        <div className="ml-auto flex items-center gap-3">
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
                    "relative whitespace-nowrap px-3 py-2 text-[14px] font-medium transition-colors duration-200",
                    active
                      ? "text-accent after:absolute after:bottom-0 after:left-3 after:right-3 after:h-[2px] after:bg-accent after:content-['']"
                      : "text-ink-2 hover:text-accent",
                  )}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
