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
    links: SITE_NAV.filter((item) => item.href !== "/contact"),
  },
  {
    title: "サポート",
    links: [
      { href: "/help", label: "ヘルプ" },
      { href: "/terms", label: "利用規約" },
      { href: "/contact", label: "お問い合わせ" },
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
          <Link href="/" className="shrink-0 transition-opacity hover:opacity-90">
            <Image
              src="/sitelogo.png"
              alt="LABNOTE"
              width={216}
              height={48}
              className="h-12 w-auto object-contain"
            />
          </Link>
          <div>
            <p className="mt-1 max-w-[32ch] text-[14px] leading-relaxed text-black/70">
              実験記録から統計解析、AI査読まで。研究室のための記録・解析プラットフォームです。
            </p>
          </div>
        </div>

        {/* Menus on the right */}
        <div className="flex flex-wrap items-start gap-x-16 gap-y-8">
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="text-[13px] font-semibold uppercase tracking-wider text-black/60">
                {col.title}
              </p>
              <ul className="mt-3 flex flex-col gap-2.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="group relative py-1 text-[14px] font-medium text-black/70 transition-colors hover:text-black"
                    >
                      {link.label}
                      <span
                        aria-hidden
                        className="absolute inset-x-0 -bottom-0.5 h-[2px] origin-left scale-x-0 rounded-full bg-accent transition-transform duration-200 group-hover:scale-x-100"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-line">
        <div className="mx-auto w-full max-w-[1100px] px-5 py-5 text-center text-[13px] text-black/60 sm:px-8">
          <p>© 2026 LABNOTE</p>
        </div>
      </div>
    </footer>
  );
}
