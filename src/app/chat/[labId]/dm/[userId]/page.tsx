import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import { ChatRoom } from "@/components/chat/ChatRoom";
import { getOrCreateDmConversationAction } from "@/lib/chat/actions";
import { listLabMembersForPicker, listRecentMessages } from "@/lib/chat/queries";

export const dynamic = "force-dynamic";

/** `userId` in the URL names the OTHER participant; the conversation itself is found or created on visit. */
export default async function ChatDmPage(
  props: PageProps<"/chat/[labId]/dm/[userId]">,
) {
  const { labId, userId: otherUserId } = await props.params;
  const ctx = await requireUser(`/chat/${labId}/dm/${otherUserId}`);
  const membership = ctx.memberships.find((m) => m.labId === labId);
  if (!membership) redirect("/chat");

  const members = await listLabMembersForPicker(labId, ctx.user.id);
  const other = members.find((m) => m.userId === otherUserId);
  if (!other) notFound();

  const result = await getOrCreateDmConversationAction(labId, otherUserId);
  if (!result.ok || !result.data) notFound();
  const dmConversationId = result.data.id;

  const messages = await listRecentMessages({ dmConversationId });

  return (
    <ChatRoom
      labId={labId}
      target={{ dmConversationId }}
      conversationId={dmConversationId}
      title={other.displayName}
      initialMessages={messages}
      viewerId={ctx.user.id}
      viewerDisplayName={ctx.displayName}
      viewerAvatarUrl={ctx.avatarUrl}
      viewerEmail={ctx.email}
      canWrite
      knownUsers={Object.fromEntries(
        members.map((m) => [
          m.userId,
          { displayName: m.displayName, avatarUrl: m.avatarUrl, email: m.email },
        ]),
      )}
      dmOtherUserId={otherUserId}
      dmOtherProfile={{
        userId: other.userId,
        displayName: other.displayName,
        email: other.email,
        avatarUrl: other.avatarUrl,
      }}
    />
  );
}
