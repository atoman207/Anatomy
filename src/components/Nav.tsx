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
  { href: "/notebook", label: "実験ノート" },
  { href: "/experiments", label: "実験一覧" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface-1/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center">
          <Image
            src="/LOGO.png"
            alt="ロゴ"
            width={60}
            height={60}
            className="h-[60px] w-[60px] rounded-xl object-contain"
            priority
          />
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <nav className="scroll-x flex items-center gap-2">
            {LINKS.map((l) => {
              const active =
                l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "whitespace-nowrap rounded-xl px-3.5 py-2 text-[18px] font-medium transition-colors",
                    active
                      ? "bg-accent-soft text-accent"
                      : "text-ink-2 hover:bg-surface-2 hover:text-ink",
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
