import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import { canWrite, canManageMembers } from "@/lib/auth/roles";
import { ChatRoom } from "@/components/chat/ChatRoom";
import {
  getChannel, listChannelMembers, listLabMembersForPicker, listRecentMessages,
} from "@/lib/chat/queries";

export const dynamic = "force-dynamic";

export default async function ChatChannelPage(
  props: PageProps<"/chat/[labId]/c/[channelId]">,
) {
  const { labId, channelId } = await props.params;
  const ctx = await requireUser(`/chat/${labId}/c/${channelId}`);
  const membership = ctx.memberships.find((m) => m.labId === labId);
  if (!membership) redirect("/chat");

  // `channels_select` RLS already refuses a private channel the viewer
  // isn't a member of, so a null result here doubles as the access check.
  const channel = await getChannel(channelId);
  if (!channel || channel.labId !== labId) notFound();

  const [messages, members, channelMembers] = await Promise.all([
    listRecentMessages({ channelId }),
    listLabMembersForPicker(labId, ctx.user.id),
    channel.isPrivate ? listChannelMembers(channelId) : Promise.resolve([]),
  ]);
  const knownUsers = Object.fromEntries(
    members.map((m) => [
      m.userId,
      { displayName: m.displayName, avatarUrl: m.avatarUrl, email: m.email },
    ]),
  );
  const canManageChannel = canManageMembers(membership.role) || channel.createdBy === ctx.user.id;
  const channelMemberIds = new Set(channelMembers.map((m) => m.userId));
  const pickableChannelMembers = members.filter((m) => !channelMemberIds.has(m.userId));

  return (
    <ChatRoom
      labId={labId}
      target={{ channelId }}
      conversationId={channelId}
      title={`${channel.isPrivate ? "🔒" : "#"} ${channel.name}`}
      subtitle={channel.topic ?? undefined}
      initialMessages={messages}
      viewerId={ctx.user.id}
      viewerDisplayName={ctx.displayName}
      viewerAvatarUrl={ctx.avatarUrl}
      viewerEmail={ctx.email}
      canWrite={canWrite(membership.role)}
      writeDisabledReason="閲覧者はメッセージを送信できません。"
      knownUsers={knownUsers}
      isPrivateChannel={channel.isPrivate}
      canManageChannel={canManageChannel}
      channelMembers={channelMembers}
      pickableChannelMembers={pickableChannelMembers}
    />
  );
}
