import { redirect } from "next/navigation";
import { EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { listChannelsForLab } from "@/lib/chat/queries";

export const dynamic = "force-dynamic";

/**
 * Lands on the lab's "general" channel (or its first channel, if somehow
 * renamed away). Every lab gets a "general" channel at creation time and
 * existing labs were backfilled by the migration, so an empty list here
 * means either every channel was archived or the migration adding chat
 * hasn't been applied to this database yet - render an explanation instead
 * of redirecting back to `/chat`, which would just bounce right back here.
 */
export default async function ChatLabIndexPage(
  props: PageProps<"/chat/[labId]">,
) {
  const { labId } = await props.params;
  await requireUser(`/chat/${labId}`);

  const channels = await listChannelsForLab(labId);
  const target = channels.find((c) => c.name === "general" && !c.archived) ?? channels.find((c) => !c.archived);
  if (!target) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState title="チャンネルがありません">
          この研究室にはまだチャンネルがありません。オーナーがチャンネルを作成すると、ここに表示されます。
        </EmptyState>
      </div>
    );
  }
  redirect(`/chat/${labId}/c/${target.id}`);
}
