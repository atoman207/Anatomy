"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { Avatar } from "./Avatar";
import { inviteToChannelAction, removeFromChannelAction } from "@/lib/chat/actions";
import type { LabMemberOption } from "@/lib/chat/types";

/**
 * Roster popover for a private channel: everyone currently in it, with an
 * "add from the lab" list for whoever can manage the channel (its creator
 * or a lab admin - `channel_members` RLS is the real gate, this just hides
 * controls a click would fail anyway). Any member, including a manager, can
 * remove their own row here too - that's leaving the channel.
 */
export function ChannelMembersPanel({
  channelId,
  members,
  pickableMembers,
  canManage,
  viewerId,
  onClose,
}: {
  channelId: string;
  members: LabMemberOption[];
  pickableMembers: LabMemberOption[];
  canManage: boolean;
  viewerId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const remove = (userId: string) => {
    startTransition(async () => {
      const result = await removeFromChannelAction(channelId, userId);
      if (result.ok) router.refresh();
    });
  };

  const add = (userId: string) => {
    startTransition(async () => {
      const result = await inviteToChannelAction(channelId, userId);
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="absolute right-4 top-12 z-20 w-72 rounded-lg border border-line bg-surface-1 p-3 shadow-xl">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
          <Icon name="lock" className="h-3.5 w-3.5 opacity-70" />
          チャンネルメンバー（{members.length}）
        </p>
        <button type="button" aria-label="閉じる" onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-surface-2">
          <Icon name="x" className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-2 flex max-h-48 flex-col gap-0.5 overflow-y-auto">
        {members.map((m) => (
          <div key={m.userId} className="flex items-center gap-2 rounded px-1 py-1 text-[13px] text-ink-2 hover:bg-surface-2">
            <Avatar name={m.displayName} avatarUrl={m.avatarUrl} size={22} className="rounded" />
            <span className="flex-1 truncate">{m.displayName}</span>
            {(canManage || m.userId === viewerId) && (
              <button
                type="button"
                aria-label={m.userId === viewerId ? "チャンネルを退出" : "メンバーを削除"}
                disabled={pending}
                onClick={() => remove(m.userId)}
                className="shrink-0 rounded p-1 text-ink-3 hover:text-danger disabled:opacity-50"
              >
                <Icon name="x" className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {canManage && pickableMembers.length > 0 && (
        <>
          <p className="mb-1 mt-3 text-[11px] font-semibold text-ink-3">メンバーを追加</p>
          <div className="flex max-h-32 flex-col gap-0.5 overflow-y-auto">
            {pickableMembers.map((m) => (
              <button
                key={m.userId}
                type="button"
                disabled={pending}
                onClick={() => add(m.userId)}
                className="flex items-center gap-2 truncate rounded px-1 py-1 text-left text-[13px] text-ink-2 hover:bg-surface-2 disabled:opacity-50"
              >
                <Avatar name={m.displayName} avatarUrl={m.avatarUrl} size={20} className="rounded" />
                <span className="truncate">{m.displayName}</span>
                <Icon name="plus" className="ml-auto h-3.5 w-3.5 shrink-0 opacity-60" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
