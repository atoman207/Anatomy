"use client";

import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode,
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
  const { toast } = useToast();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [notifications, setNotifications] = useState<NotificationsResponse | null>(null);
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
    let cancelled = false;

    const read = async () => {
      try {
        const [meRes, noticeRes] = await Promise.all([
          fetch("/api/me", { cache: "no-store" }),
          fetch("/api/notifications", { cache: "no-store" }),
        ]);
        const nextMe = (await meRes.json()) as MeResponse;
        const nextNotices = (await noticeRes.json()) as NotificationsResponse;
        if (cancelled) return;
        setMe(nextMe);
        setNotifications(nextNotices);

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
  }, [pathname, toast]);

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

  return (
    <div className="flex min-h-dvh bg-surface-0">
      {/* Desktop rail */}
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-40 hidden shrink-0 border-r border-[var(--shell-border)] lg:block",
          "transition-[width] duration-200",
        )}
        style={{ width: collapsed ? "var(--sidebar-width-collapsed)" : "var(--sidebar-width)" }}
      >
        <Sidebar me={me} collapsed={collapsed} />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <>
          <button
            aria-label="メニューを閉じる"
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-[var(--sidebar-width)] border-r border-[var(--shell-border)] lg:hidden">
            <Sidebar me={me} collapsed={false} onNavigate={() => setDrawerOpen(false)} />
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
        <Header
          me={me}
          notifications={notifications}
          onToggleSidebar={toggle}
          sidebarCollapsed={collapsed}
        />
        <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <div className="mx-auto w-full max-w-[1280px]">{children}</div>
        </main>
        <footer className="border-t border-line px-4 py-3 text-center text-[12px] text-ink-3 sm:px-6">
          保存するまで、データは外部へ送信されません。
        </footer>
      </div>
    </div>
  );
}
