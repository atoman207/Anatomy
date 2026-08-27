"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { getUnreadCountsAction } from "@/lib/chat/actions";

function formatUnread(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/**
 * Lab switcher tabs with a red unread count badge in the lower-right of
 * each tab that has messages the viewer has not yet read.
 */
export function LabTabs({
  labs,
  currentLabId,
  viewerId,
  initialUnreadCounts = {},
}: {
  labs: { id: string; name: string }[];
  currentLabId: string;
  viewerId: string;
  initialUnreadCounts?: Record<string, number>;
}) {
  const labIds = labs.map((l) => l.id);
  const labIdKey = labIds.join(",");
  const [counts, setCounts] = useState<Record<string, number>>(initialUnreadCounts);
  // Re-seeds from the freshly-loaded server data when the route switches labs,
  // adjusted during render rather than in an effect - see the identical
  // pattern (and rationale) in ChatSidebar's seededForLab.
  const [seededForLab, setSeededForLab] = useState(currentLabId);
  if (currentLabId !== seededForLab) {
    setSeededForLab(currentLabId);
    setCounts(initialUnreadCounts);
  }
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    void getUnreadCountsAction(labIds).then(setCounts);
  }, [labIdKey]); // eslint-disable-line react-hooks/exhaustive-deps -- labIds derived from labIdKey

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      refresh();
    }, 250);
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [refresh, currentLabId]);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel = supabase
        .channel(`lab-unread:${viewerId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          (payload) => {
            const row = payload.new as { lab_id?: string; sender_id?: string | null };
            if (!row.lab_id || row.sender_id === viewerId) return;
            if (!labIds.includes(row.lab_id)) return;
            setCounts((prev) => ({
              ...prev,
              [row.lab_id!]: (prev[row.lab_id!] ?? 0) + 1,
            }));
            scheduleRefresh();
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "chat_conversation_reads",
            filter: `user_id=eq.${viewerId}`,
          },
          () => scheduleRefresh(),
        )
        .subscribe();
    });

    const onFocus = () => scheduleRefresh();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [viewerId, labIdKey, scheduleRefresh]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="flex flex-1 flex-wrap items-center gap-1 overflow-x-auto overflow-y-hidden"
      role="tablist"
      aria-label="研究室"
    >
      {labs.map((l) => {
        const active = l.id === currentLabId;
        const unread = counts[l.id] ?? 0;
        return (
          <Link
            key={l.id}
            href={`/chat/${l.id}`}
            role="tab"
            aria-selected={active}
            aria-label={unread > 0 ? `${l.name}、未読 ${unread} 件` : l.name}
            className={cx(
              "relative shrink-0 rounded-md border px-2.5 py-0.5 text-[12px] font-medium leading-5 transition-colors",
              unread > 0 && "pr-6",
              active
                ? "border-accent bg-accent-soft text-accent"
                : "border-line bg-surface-1 text-ink-2 hover:border-accent hover:text-accent",
            )}
          >
            {l.name}
            {unread > 0 && (
              <span
                className="absolute bottom-0.5 right-0.5 grid min-w-[1rem] place-items-center rounded-full bg-danger px-1 py-px text-[9px] font-bold leading-none text-white"
                aria-hidden
              >
                {formatUnread(unread)}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
