import Link from "next/link";
import Image from "next/image";
import { SITE_NAV } from "./SiteHeader";

interface FooterColumn {
  title: string;
  links: { href: string; label: string }[];
}

const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: "プロダクト",
    links: SITE_NAV,
  },
  {
    title: "サポート",
    links: [
      { href: "/help", label: "ヘルプ" },
      { href: "/terms", label: "利用規約" },
    ],
  },
];

/** Shared by every public page - see SiteHeader for why. */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line bg-surface-1">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-10 px-5 py-14 sm:px-8 lg:flex-row lg:items-start lg:justify-between">
        {/* Image on the left */}
        <div className="flex items-start gap-3">
          <Image
            src="/LOGO.png"
            alt=""
            width={40}
            height={40}
            className="h-10 w-10 shrink-0 rounded-md object-contain"
          />
          <div>
            <p className="text-[16px] font-semibold tracking-wide text-ink">LABNOTE.</p>
            <p className="mt-1 max-w-[32ch] text-[14px] leading-relaxed text-ink-2">
              実験記録から統計解析、AI査読まで。研究室のための記録・解析プラットフォームです。
            </p>
          </div>
        </div>

        {/* Menus on the right */}
        <div className="flex flex-wrap items-start gap-x-16 gap-y-8">
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="text-[13px] font-semibold uppercase tracking-wider text-ink-3">
                {col.title}
              </p>
              <ul className="mt-3 flex flex-col gap-2.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-[14px] text-ink-2 transition-colors hover:text-ink"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <Link
            href="/contact"
            className="rounded-md bg-accent px-5 py-2.5 text-[14px] font-medium text-accent-contrast transition-opacity hover:opacity-90"
          >
            Contact
          </Link>
        </div>
      </div>

      <div className="border-t border-line">
        <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-2 px-5 py-5 text-[13px] text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>© 2026 LABNOTE.</p>
          <nav aria-label="フッター補助" className="flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/terms" className="transition-colors hover:text-ink">
              利用規約
            </Link>
            <Link href="/contact" className="transition-colors hover:text-ink">
              お問い合わせ
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
