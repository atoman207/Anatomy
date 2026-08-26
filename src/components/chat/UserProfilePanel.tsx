"use client";

import { Icon } from "@/components/icons";
import { Avatar } from "./Avatar";

export type ProfileUser = {
  userId: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
};

/**
 * Slack-style profile drawer docked to the right of the chat room:
 * large avatar, display name, and contact email.
 */
export function UserProfilePanel({
  user,
  onClose,
}: {
  user: ProfileUser;
  onClose: () => void;
}) {
  return (
    <aside
      className="flex h-full w-72 shrink-0 flex-col border-l border-line bg-surface-1"
      aria-label="プロフィール"
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
        <p className="text-[14px] font-bold text-ink">プロフィール</p>
        <button
          type="button"
          aria-label="閉じる"
          onClick={onClose}
          className="rounded p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink"
        >
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto px-5 py-6">
        <div className="flex justify-center">
          <Avatar
            name={user.displayName}
            avatarUrl={user.avatarUrl}
            size={128}
            className="rounded-2xl"
          />
        </div>

        <h3 className="mt-5 truncate text-center text-[20px] font-bold tracking-tight text-ink">
          {user.displayName}
        </h3>

        <div className="mt-8">
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
            連絡先
          </p>
          <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-2/60 px-3 py-3">
            <Icon name="mail" className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-ink-3">メールアドレス</p>
              {user.email ? (
                <a
                  href={`mailto:${user.email}`}
                  className="mt-0.5 block break-all text-[13px] text-accent hover:underline"
                >
                  {user.email}
                </a>
              ) : (
                <p className="mt-0.5 text-[13px] text-ink-3">（未設定）</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
