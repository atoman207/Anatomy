"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { Avatar } from "./Avatar";
import {
  createChannelAction,
  getConversationUnreadCountsAction,
  getOrCreateDmConversationAction,
} from "@/lib/chat/actions";
import { createClient } from "@/lib/supabase/client";
import type { ChannelSummary, DmConversationSummary, LabMemberOption } from "@/lib/chat/types";

function formatUnread(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/** Channel/DM list for the active lab, styled with the site's own tokens rather than a separate palette. */
export function ChatSidebar({
  labId,
  labName,
  channels,
  dms,
  members,
  canManageChannels,
  viewerId,
  initialUnread = { byChannel: {}, byDm: {} },
}: {
  labId: string;
  labName: string;
  channels: ChannelSummary[];
  dms: DmConversationSummary[];
  members: LabMemberOption[];
  canManageChannels: boolean;
  viewerId: string;
  initialUnread?: { byChannel: Record<string, number>; byDm: Record<string, number> };
}) {
  const [byChannel, setByChannel] = useState(initialUnread.byChannel);
  const [byDm, setByDm] = useState(initialUnread.byDm);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();

  const refresh = useCallback(() => {
    void getConversationUnreadCountsAction(labId).then((next) => {
      setByChannel(next.byChannel);
      setByDm(next.byDm);
    });
  }, [labId]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      refresh();
    }, 250);
  }, [refresh]);

  useEffect(() => {
    setByChannel(initialUnread.byChannel);
    setByDm(initialUnread.byDm);
  }, [labId]); // eslint-disable-line react-hooks/exhaustive-deps -- re-seed when lab changes

  useEffect(() => {
    refresh();
  }, [refresh, pathname]);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel = supabase
        .channel(`sidebar-unread:${labId}:${viewerId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `lab_id=eq.${labId}`,
          },
          (payload) => {
            const row = payload.new as {
              sender_id?: string | null;
              channel_id?: string | null;
              dm_conversation_id?: string | null;
            };
            if (row.sender_id === viewerId) return;
            if (row.channel_id) {
              setByChannel((prev) => ({
                ...prev,
                [row.channel_id!]: (prev[row.channel_id!] ?? 0) + 1,
              }));
            }
            if (row.dm_conversation_id) {
              setByDm((prev) => ({
                ...prev,
                [row.dm_conversation_id!]: (prev[row.dm_conversation_id!] ?? 0) + 1,
              }));
            }
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

    return () => {
      cancelled = true;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [labId, viewerId, scheduleRefresh]);

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-line bg-surface-2">
      <div className="flex h-12 shrink-0 items-center border-b border-line px-4">
        <h1 className="truncate text-[14px] font-bold text-ink">{labName}</h1>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-3">
        <ChannelSection
          labId={labId}
          channels={channels}
          canManageChannels={canManageChannels}
          members={members}
          unreadByChannel={byChannel}
        />
        <DmSection labId={labId} dms={dms} members={members} unreadByDm={byDm} />
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="mb-1 mt-4 flex items-center justify-between px-2 text-[12px] font-semibold text-ink-3">
      {children}
    </div>
  );
}

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="ml-auto grid min-w-[1.15rem] shrink-0 place-items-center rounded-full bg-danger px-1 py-0.5 text-[10px] font-bold leading-none text-white"
      aria-hidden
    >
      {formatUnread(count)}
    </span>
  );
}

function SidebarRow({
  href,
  active,
  icon,
  label,
  muted,
  unread = 0,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  muted?: boolean;
  unread?: number;
}) {
  return (
    <Link
      href={href}
      aria-label={unread > 0 ? `${label}、未読 ${unread} 件` : label}
      className={cx(
        "flex items-center gap-2 rounded px-2 py-[6px] text-[14px] leading-tight",
        active ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:bg-surface-3",
      )}
    >
      {icon}
      <span className={cx("min-w-0 flex-1 truncate", muted && "text-ink-3")}>{label}</span>
      <UnreadBadge count={unread} />
    </Link>
  );
}

function ChannelSection({
  labId,
  channels,
  canManageChannels,
  members,
  unreadByChannel,
}: {
  labId: string;
  channels: ChannelSummary[];
  canManageChannels: boolean;
  members: LabMemberOption[];
  unreadByChannel: Record<string, number>;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [inviteIds, setInviteIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();

  const visible = channels.filter((c) => !c.archived);

  const resetForm = () => {
    setName("");
    setIsPrivate(false);
    setInviteIds(new Set());
    setError(null);
    setCreating(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between px-2">
        <SectionLabel>チャンネル</SectionLabel>
        {canManageChannels && (
          <button
            type="button"
            aria-label="チャンネルを作成"
            onClick={() => setCreating((v) => !v)}
            className="rounded p-1 text-ink-3 hover:bg-surface-3 hover:text-ink"
          >
            <Icon name="plus" className="h-4 w-4" />
          </button>
        )}
      </div>

      {visible.map((c) => (
        <SidebarRow
          key={c.id}
          href={`/chat/${labId}/c/${c.id}`}
          active={pathname === `/chat/${labId}/c/${c.id}`}
          icon={
            <Icon
              name={c.isPrivate ? "lock" : "hash"}
              className="h-4 w-4 shrink-0 opacity-70"
            />
          }
          label={c.name}
          unread={unreadByChannel[c.id] ?? 0}
        />
      ))}

      {creating && (
        <form
          className="mt-1 flex flex-col gap-2 rounded border border-line bg-surface-1 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            const formData = new FormData();
            formData.set("lab_id", labId);
            formData.set("name", name.trim());
            if (isPrivate) {
              formData.set("is_private", "on");
              for (const id of inviteIds) formData.append("invite_user_ids", id);
            }
            setError(null);
            startTransition(async () => {
              const result = await createChannelAction(null, formData);
              if (result.ok) {
                resetForm();
                router.refresh();
              } else {
                setError(result.message);
              }
            });
          }}
        >
          {error && <p className="px-0.5 text-[12px] text-danger">{error}</p>}
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="channel-name"
            className="rounded border border-line-strong bg-surface-1 px-2 py-1 text-[13px] text-ink placeholder:text-ink-3 focus:outline-none"
          />

          <label className="flex items-center gap-1.5 px-0.5 text-[12px] text-ink-2">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            <Icon name="lock" className="h-3 w-3 opacity-70" />
            非公開チャンネルにする
          </label>

          {isPrivate && (
            <div className="flex flex-col gap-1 rounded border border-line bg-surface-2 p-1.5">
              <p className="px-0.5 text-[11px] text-ink-3">招待するメンバー（あなたは自動的に参加します）</p>
              {members.length === 0 ? (
                <p className="px-0.5 text-[11px] text-ink-3">他に招待できるメンバーがいません。</p>
              ) : (
                <div className="max-h-32 overflow-y-auto">
                  {members.map((m) => (
                    <label key={m.userId} className="flex items-center gap-1.5 rounded px-1 py-1 text-[12px] text-ink-2 hover:bg-surface-3">
                      <input
                        type="checkbox"
                        checked={inviteIds.has(m.userId)}
                        onChange={(e) => {
                          setInviteIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(m.userId);
                            else next.delete(m.userId);
                            return next;
                          });
                        }}
                        className="h-3.5 w-3.5 shrink-0"
                      />
                      <Avatar name={m.displayName} avatarUrl={m.avatarUrl} size={16} className="rounded" />
                      <span className="truncate">{m.displayName}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={resetForm}
              className="rounded px-2 py-1 text-[12px] text-ink-3 hover:bg-surface-3"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={pending || !name.trim()}
              className="rounded bg-accent px-2 py-1 text-[12px] font-medium text-accent-contrast disabled:opacity-50"
            >
              作成
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function DmSection({
  labId,
  dms,
  members,
  unreadByDm,
}: {
  labId: string;
  dms: DmConversationSummary[];
  members: LabMemberOption[];
  unreadByDm: Record<string, number>;
}) {
  const [picking, setPicking] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();

  const dmOtherIds = new Set(dms.map((d) => d.otherUserId));
  const pickable = members.filter((m) => !dmOtherIds.has(m.userId));

  return (
    <div>
      <div className="flex items-center justify-between px-2">
        <SectionLabel>ダイレクトメッセージ</SectionLabel>
        {pickable.length > 0 && (
          <button
            type="button"
            aria-label="DMを開始"
            onClick={() => setPicking((v) => !v)}
            className="rounded p-1 text-ink-3 hover:bg-surface-3 hover:text-ink"
          >
            <Icon name="plus" className="h-4 w-4" />
          </button>
        )}
      </div>

      {dms.map((d) => (
        <SidebarRow
          key={d.id}
          href={`/chat/${labId}/dm/${d.otherUserId}`}
          active={pathname === `/chat/${labId}/dm/${d.otherUserId}`}
          icon={<Avatar name={d.otherDisplayName} avatarUrl={d.otherAvatarUrl} size={18} className="rounded" />}
          label={d.otherDisplayName}
          unread={unreadByDm[d.id] ?? 0}
        />
      ))}

      {picking && (
        <div className="mt-1 flex flex-col gap-1 rounded border border-line bg-surface-1 p-1.5">
          {pickable.map((m) => (
            <button
              key={m.userId}
              type="button"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  const result = await getOrCreateDmConversationAction(labId, m.userId);
                  if (result.ok) {
                    setPicking(false);
                    router.push(`/chat/${labId}/dm/${m.userId}`);
                    router.refresh();
                  }
                });
              }}
              className="flex items-center gap-2 truncate rounded px-2 py-1 text-left text-[13px] text-ink-2 hover:bg-surface-3 disabled:opacity-50"
            >
              <Avatar name={m.displayName} avatarUrl={m.avatarUrl} size={18} className="rounded" />
              <span className="truncate">{m.displayName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
