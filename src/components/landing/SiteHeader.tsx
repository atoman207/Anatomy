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
 * single right-aligned block. Nav links get an animated underline instead of
 * a flat color swap, and the logo sits in its own soft-edged tile - small
 * details that read as "designed" rather than a bare row of links.
 */
export function SiteHeader({ signedIn, overHero = false }: { signedIn: boolean; overHero?: boolean }) {
  return (
    <header
      className={
        overHero
          ? "fixed inset-x-0 top-0 z-30 border-b border-black/5 bg-white/75 backdrop-blur-md"
          : "sticky top-0 z-30 border-b border-black/5 bg-white/90 shadow-[0_1px_0_rgba(0,0,0,0.04)] backdrop-blur-md"
      }
    >
      <div className="flex h-[77px] w-full items-center gap-4 px-5 sm:px-8">
        <Link href="/" className="group shrink-0 transition-opacity hover:opacity-90">
          <Image
            src="/sitelogo.png"
            alt="LABNOTE"
            width={230}
            height={52}
            className="h-[52px] w-auto object-contain"
            priority
          />
        </Link>

        <div className="ml-auto flex items-center gap-7">
          <nav aria-label="サイト" className="hidden items-center gap-7 sm:flex">
            {SITE_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group relative py-1 text-[14px] font-medium text-black/70 transition-colors hover:text-black"
              >
                {item.label}
                <span
                  aria-hidden
                  className="absolute inset-x-0 -bottom-0.5 h-[2px] origin-left scale-x-0 rounded-full bg-accent transition-transform duration-200 group-hover:scale-x-100"
                />
              </Link>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-3 sm:gap-4">
            {signedIn ? (
              <Link
                href="/dashboard"
                className="rounded-full bg-accent px-4 py-2 text-[14px] font-semibold text-accent-contrast shadow-[0_1px_2px_rgba(0,0,0,0.12)] transition-all hover:opacity-90 hover:shadow-[0_2px_8px_rgba(37,99,235,0.35)]"
              >
                ダッシュボード
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="hidden text-[14px] font-medium text-black/70 transition-colors hover:text-black sm:block"
                >
                  ログイン
                </Link>
                <Link
                  href="/register"
                  className="rounded-full bg-accent px-4 py-2 text-[14px] font-semibold text-accent-contrast shadow-[0_1px_2px_rgba(0,0,0,0.12)] transition-all hover:opacity-90 hover:shadow-[0_2px_8px_rgba(37,99,235,0.35)]"
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
