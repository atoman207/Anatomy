"use client";

import type { ReactNode } from "react";
import { ChatSidebar } from "./ChatSidebar";
import { CallProvider } from "./CallContext";
import { LabTabs } from "./LabTabs";
import type { ChannelSummary, DmConversationSummary, LabMemberOption } from "@/lib/chat/types";

/**
 * The persistent frame for the whole /chat/[labId] subtree: a lab tab bar,
 * the channel/DM sidebar, and a slot for the active conversation.
 *
 * Rendered inside the normal app shell (header + left nav both stay
 * visible - AppShell no longer treats /chat as chromeless), so this sizes
 * itself to the remaining content area rather than taking over the
 * viewport, and uses the site's own design tokens (`bg-surface-*`,
 * `text-ink*`, `border-line`, `accent`) instead of a separate palette.
 */
export function ChatShell({
  labs,
  currentLabId,
  labName,
  channels,
  dms,
  members,
  canManageChannels,
  viewerId,
  viewerDisplayName,
  initialUnreadCounts,
  initialConversationUnread,
  children,
}: {
  labs: { id: string; name: string }[];
  currentLabId: string;
  labName: string;
  channels: ChannelSummary[];
  dms: DmConversationSummary[];
  members: LabMemberOption[];
  canManageChannels: boolean;
  viewerId: string;
  viewerDisplayName: string;
  initialUnreadCounts?: Record<string, number>;
  initialConversationUnread?: { byChannel: Record<string, number>; byDm: Record<string, number> };
  children: ReactNode;
}) {
  return (
    <div className="flex h-[calc(100dvh-var(--header-height)-8rem)] min-h-[520px] flex-col overflow-hidden rounded-xl border border-line bg-surface-1 shadow-sm">
      {/* Lab tabs - a user can belong to several labs, so switching between
          them is a compact tab strip rather than a fixed workspace. */}
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-2 py-1">
        <LabTabs
          labs={labs}
          currentLabId={currentLabId}
          viewerId={viewerId}
          initialUnreadCounts={initialUnreadCounts}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <ChatSidebar
          labId={currentLabId}
          labName={labName}
          channels={channels}
          dms={dms}
          members={members}
          canManageChannels={canManageChannels}
          viewerId={viewerId}
          initialUnread={initialConversationUnread}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <CallProvider labId={currentLabId} viewerId={viewerId} viewerDisplayName={viewerDisplayName}>
            {children}
          </CallProvider>
        </div>
      </div>
    </div>
  );
}
