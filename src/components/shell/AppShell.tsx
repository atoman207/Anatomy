"use client";

import {
  Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/shell/Toast";
import {
  subscribeSidebar, getSidebarCollapsed, getSidebarCollapsedServer, setSidebarCollapsed,
} from "./sidebarPreference";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import type { MeResponse } from "@/app/api/me/route";
import type { NotificationsResponse } from "@/app/api/notifications/route";
import type { TodayResponse } from "@/app/api/notebook/today/route";

/**
 * The application frame: fixed sidebar, top bar, scrolling content.
 *
 * Identity and notifications are fetched once here and passed down, rather
 * than each piece of chrome fetching for itself — the header and the sidebar
 * showing different ideas of who is signed in would be worse than either being
 * slightly stale.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  /*
   * Public marketing pages carry their own SiteHeader / SiteFooter and are
   * full-bleed rather than capped at the content width. They are mostly seen
   * by visitors with no session - so the signed-in chrome is skipped entirely
   * rather than rendered empty (or nested around the public chrome).
   */
  const isPublicSite = isPublicSitePath(pathname);
  const { toast } = useToast();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [notifications, setNotifications] = useState<NotificationsResponse | null>(null);
  const [today, setToday] = useState<TodayResponse | null>(null);
  const toastedNoticeIds = useRef(new Set<string>());
  const collapsed = useSyncExternalStore(
    subscribeSidebar,
    getSidebarCollapsed,
    getSidebarCollapsedServer,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Closing the drawer on navigation is a state reset driven by a changing
  // input, so it is adjusted during render. In an effect it would flash the
  // open drawer for one frame and trip the cascading-render rule.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    if (drawerOpen) setDrawerOpen(false);
  }

  // Identity and notifications, refreshed on navigation and on auth changes.
  useEffect(() => {
    // Nothing on public marketing pages consumes either, and most of their
    // traffic is signed out, so they should not cost two authenticated round trips.
    if (isPublicSite) return;
    let cancelled = false;

    const read = async () => {
      try {
        const [meRes, noticeRes, todayRes] = await Promise.all([
          fetch("/api/me", { cache: "no-store" }),
          fetch("/api/notifications", { cache: "no-store" }),
          fetch("/api/notebook/today", { cache: "no-store" }),
        ]);
        const nextMe = (await meRes.json()) as MeResponse;
        const nextNotices = (await noticeRes.json()) as NotificationsResponse;
        const nextToday = (await todayRes.json()) as TodayResponse;
        if (cancelled) return;
        setMe(nextMe);
        setNotifications(nextNotices);
        setToday(nextToday);

        // Surface urgent notices as toasts once each, so they are not missed
        // waiting inside the header bell. Info items stay in the dropdown.
        for (const notice of nextNotices.notices) {
          if (notice.tone !== "warn" && notice.tone !== "danger") continue;
          if (toastedNoticeIds.current.has(notice.id)) continue;
          toastedNoticeIds.current.add(notice.id);
          toast(notice.detail, {
            tone: notice.tone,
            title: notice.title,
            // Already listed via /api/notifications; do not duplicate in the store.
            persist: false,
          });
        }
      } catch {
        if (!cancelled) {
          setMe({
            signedIn: false, email: null, displayName: null, avatarUrl: null,
            platformRole: "user", isPlatformAdmin: false, canAccessAdmin: false, labs: [],
          });
        }
      }
    };

    void read();

    let unsubscribe: (() => void) | undefined;
    try {
      const supabase = createClient();
      const { data } = supabase.auth.onAuthStateChange(() => void read());
      unsubscribe = () => data.subscription.unsubscribe();
    } catch {
      // Supabase is optional; the shell still renders signed out.
    }

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [pathname, toast, isPublicSite]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const toggle = useCallback(() => {
    // Below the lg breakpoint the sidebar is a drawer, not a rail.
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setDrawerOpen((v) => !v);
      return;
    }
    setSidebarCollapsed(!collapsed);
  }, [collapsed]);

  // Declared after every hook above, so the hook order never changes.
  if (isPublicSite) return <>{children}</>;

  return (
    <div className="flex min-h-dvh bg-surface-0">
      {/* Desktop rail */}
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-40 hidden shrink-0 lg:block",
          "transition-[width] duration-200",
        )}
        style={{ width: collapsed ? "var(--sidebar-width-collapsed)" : "var(--sidebar-width)" }}
      >
        {/* Sidebar reads useSearchParams() (for highlighting a step deep
            link like /record?step=4) - Suspense is required here, otherwise
            static generation of any page that doesn't itself provide search
            params (e.g. the 404 page) fails the build. */}
        <Suspense fallback={null}>
          <Sidebar me={me} collapsed={collapsed} />
        </Suspense>
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <>
          <button
            aria-label="メニューを閉じる"
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-[var(--sidebar-width)] lg:hidden">
            <Suspense fallback={null}>
              <Sidebar me={me} collapsed={false} onNavigate={() => setDrawerOpen(false)} />
            </Suspense>
          </aside>
        </>
      )}

      {/*
        The offset is expressed in CSS rather than measured in JS: reading
        window.innerWidth during render would differ between server and client
        and break hydration. The lg: prefix does the breakpoint, and the custom
        property carries the current width.
      */}
      <div
        className={cx(
          "flex min-w-0 flex-1 flex-col lg:pl-[var(--sidebar-current)]",
          "transition-[padding] duration-200",
        )}
        style={
          {
            "--sidebar-current": collapsed
              ? "var(--sidebar-width-collapsed)"
              : "var(--sidebar-width)",
          } as React.CSSProperties
        }
      >
        {/* Header also reads useSearchParams() - same Suspense requirement as Sidebar above. */}
        <Suspense fallback={null}>
          <Header
            me={me}
            notifications={notifications}
            today={today}
            onToggleSidebar={toggle}
            sidebarCollapsed={collapsed}
          />
        </Suspense>
        <main className="flex-1 px-3 py-5 sm:px-4 sm:py-6">
          <div className="w-full">{children}</div>
        </main>
        <footer className="border-t border-line px-3 py-3 text-center text-[12px] text-ink-3 sm:px-4">
          © 2026 LABNOTE.
        </footer>
      </div>
    </div>
  );
}

/** Landing-site routes that own their own chrome (no sidebar / app header). */
function isPublicSitePath(pathname: string): boolean {
  if (pathname === "/") return true;
  const publicRoots = ["/contact", "/help", "/terms", "/link-to-us", "/login", "/auth"];
  return publicRoots.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}
