import Link from "next/link";
import Image from "next/image";

/**
 * Shared by every public (unauthenticated) page - the landing page itself,
 * plus /terms, /help, and /contact - so the same identity and menu appear
 * wherever a signed-out visitor lands.
 *
 * Deliberately full-width with edge padding only, no `mx-auto max-w-[…]`
 * wrapper: the dashboard's own header (see Sidebar.tsx's brand row) pins the
 * logo flush against the shell's left edge, and this should read the same
 * way rather than floating in a centered reading column with dead space
 * beside it on wide screens.
 *
 * The logo sits alone on the left; the nav links and the sign-in/CTA button
 * are grouped into one cluster pinned to the right (`ml-auto`) rather than
 * spread across the bar with `justify-between`, so the menu reads as a
 * single right-aligned block.
 */
export function SiteHeader({ signedIn, overHero = false }: { signedIn: boolean; overHero?: boolean }) {
  return (
    <header
      className={
        overHero
          ? "fixed inset-x-0 top-0 z-30 border-b border-line/40 bg-surface-1/80 backdrop-blur"
          : "sticky top-0 z-30 border-b border-line bg-surface-1/90 backdrop-blur"
      }
    >
      <div className="flex w-full items-center gap-4 px-5 py-3.5 sm:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <Image
            src="/LOGO.png"
            alt=""
            width={39}
            height={39}
            className="h-[38.4px] w-[38.4px] rounded-md object-contain"
          />
          <span className="text-[16px] font-semibold tracking-wide text-ink">LABNOTE.</span>
        </Link>

        <div className="ml-auto flex items-center gap-6">
          <nav aria-label="サイト" className="hidden items-center gap-6 sm:flex">
            {SITE_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-[14px] text-ink-2 transition-colors hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {signedIn ? (
              <Link
                href="/dashboard"
                className="rounded-md bg-accent px-4 py-2 text-[14px] font-medium text-accent-contrast transition-opacity hover:opacity-90"
              >
                ダッシュボード
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="hidden text-[14px] text-ink-2 transition-colors hover:text-ink sm:block"
                >
                  ログイン
                </Link>
                <Link
                  href="/login"
                  className="rounded-md bg-accent px-4 py-2 text-[14px] font-medium text-accent-contrast transition-opacity hover:opacity-90"
                >
                  無料で始める
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

/** Anchors point at `/#id` (not a bare `#id`) so they work from other public pages too. */
export const SITE_NAV: { href: string; label: string }[] = [
  { href: "/#about", label: "サービスについて" },
  { href: "/#features", label: "できること" },
  { href: "/#pricing", label: "料金" },
  { href: "/contact", label: "お問い合わせ" },
];
