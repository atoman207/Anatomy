import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import { canManageMembers } from "@/lib/auth/roles";
import { ChatShell } from "@/components/chat/ChatShell";
import {
  getConversationUnreadCounts,
  getUnreadCountsByLab,
  listChannelsForLab,
  listDmConversationsForLab,
  listLabMembersForPicker,
} from "@/lib/chat/queries";

export const dynamic = "force-dynamic";

/**
 * Frame for the whole /chat/[labId] subtree: verifies membership (same
 * `ctx.memberships`-based gate every other user-facing lab page uses - a
 * platform admin does not get a bypass here, since the realtime
 * subscriptions and reads below run on the session-scoped client, and
 * `is_lab_member`/`can_write_lab` at the RLS layer have no platform-role
 * awareness either), then renders the persistent chat shell around
 * whichever channel or DM the child route picks.
 */
export default async function ChatLabLayout(
  props: LayoutProps<"/chat/[labId]">,
) {
  const { labId } = await props.params;
  const ctx = await requireUser(`/chat/${labId}`);
  const membership = ctx.memberships.find((m) => m.labId === labId);
  if (!membership) redirect("/chat");

  const labIds = ctx.memberships.map((m) => m.labId);
  const [channels, dms, members, unreadCounts, conversationUnread] = await Promise.all([
    listChannelsForLab(labId),
    listDmConversationsForLab(labId, ctx.user.id),
    listLabMembersForPicker(labId, ctx.user.id),
    getUnreadCountsByLab(ctx.user.id, labIds),
    getConversationUnreadCounts(ctx.user.id, labId),
  ]);

  return (
    <ChatShell
      labs={ctx.memberships.map((m) => ({ id: m.labId, name: m.labName }))}
      currentLabId={labId}
      labName={membership.labName}
      channels={channels}
      dms={dms}
      members={members}
      canManageChannels={canManageMembers(membership.role)}
      viewerId={ctx.user.id}
      viewerDisplayName={ctx.displayName}
      initialUnreadCounts={unreadCounts}
      initialConversationUnread={conversationUnread}
    >
      {props.children}
    </ChatShell>
  );
}
