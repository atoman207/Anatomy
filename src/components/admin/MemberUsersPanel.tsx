"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Button, cx } from "@/components/ui";
import { formatJpy } from "@/lib/billing/plans";

export interface MemberPaymentUser {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  /** Net paid to date in yen (refunds subtracted). */
  paidTotalJpy: number;
  /** ISO timestamp. */
  signedUpAt: string;
}

const PREVIEW = 5;

function formatSignedUp(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

/** Newest sign-ups first. */
function byMostRecent(a: MemberPaymentUser, b: MemberPaymentUser): number {
  return a.signedUpAt < b.signedUpAt ? 1 : a.signedUpAt > b.signedUpAt ? -1 : 0;
}

function UserRow({ user }: { user: MemberPaymentUser }) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-[14px] font-medium text-ink">{user.name}</p>
          {user.isAdmin && (
            <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">
              管理者
            </span>
          )}
        </div>
        <p className="truncate text-[12px] text-ink-3">{user.email}</p>
      </div>
      <div className="shrink-0 whitespace-nowrap text-right">
        <p className="text-[14px] font-semibold tabular-nums text-ink">
          {formatJpy(user.paidTotalJpy)}
        </p>
        <p className="text-[11px] text-ink-3">登録 {formatSignedUp(user.signedUpAt)}</p>
      </div>
    </li>
  );
}

/**
 * Shows the 5 most recently signed-up members. もっと見る always sits at the
 * top right and opens the full roster (administrators first) in a modal.
 */
export function MemberUsersPanel({ users }: { users: MemberPaymentUser[] }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  const preview = useMemo(
    () => [...users].sort(byMostRecent).slice(0, PREVIEW),
    [users],
  );

  const fullList = useMemo(
    () =>
      [...users].sort((a, b) => {
        if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
        return byMostRecent(a, b);
      }),
    [users],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] font-medium text-ink-3">
          会員一覧（直近{PREVIEW}名）
        </p>
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          もっと見る
        </Button>
      </div>

      <ul className="flex flex-col">
        {preview.length === 0 ? (
          <li className="py-6 text-center text-[13px] text-ink-3">登録会員はまだいません。</li>
        ) : (
          preview.map((u) => <UserRow key={u.id} user={u} />)
        )}
      </ul>

      {open && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 px-4"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className={cx(
              "flex max-h-[min(80vh,640px)] w-full max-w-lg flex-col overflow-hidden",
              "rounded-lg border border-line bg-surface-1 shadow-[var(--shadow-md)]",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 id={titleId} className="font-serif text-base font-semibold text-ink">
                  登録会員一覧
                </h2>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  全{users.length}名 · 管理者を先頭 · 累計支払いは返金差引後
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)} aria-label="閉じる">
                閉じる
              </Button>
            </header>
            <ul className="shell-scroll flex-1 overflow-y-auto px-5 py-1">
              {fullList.length === 0 ? (
                <li className="py-8 text-center text-[13px] text-ink-3">登録会員はまだいません。</li>
              ) : (
                fullList.map((u) => <UserRow key={u.id} user={u} />)
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
