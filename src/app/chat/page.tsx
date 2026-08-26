import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

/** Entry point: send the viewer to their first laboratory's chat. */
export default async function ChatIndexPage() {
  const ctx = await requireUser("/chat");
  const first = ctx.memberships[0];
  if (!first) redirect("/labs");
  redirect(`/chat/${first.labId}`);
}
