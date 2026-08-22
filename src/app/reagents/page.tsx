import Link from "next/link";
import { Callout } from "@/components/ui";
import { createServerSupabase, getCurrentUser, isSupabaseConfigured } from "@/lib/supabase/server";
import { ReagentManager, type LabOption } from "@/components/reagents/ReagentManager";

export const dynamic = "force-dynamic";

export default async function ReagentsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <Callout tone="info" title="試薬・Lot管理は現在利用できません">
        管理者にお問い合わせください。
      </Callout>
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-ink">試薬・Lot</h1>
        <Callout tone="info" title="ログインしてください">
          <Link href="/login" className="text-accent underline">ログイン</Link>
          すると、試薬・Lotを記録できます。
        </Callout>
      </div>
    );
  }

  const { ensurePersonalLab } = await import("@/lib/labs/personalLab");
  const displayName =
    (user.user_metadata?.display_name as string | undefined) ||
    user.email?.split("@")[0] ||
    "個人";
  await ensurePersonalLab(user.id, displayName);

  const supabase = await createServerSupabase();
  const { data: memberships, error: memberError } = await supabase
    .from("lab_members")
    .select("lab_id, laboratories(id, name)")
    .order("joined_at", { ascending: true });

  if (memberError) {
    return (
      <Callout tone="danger" title="ワークスペースを読み込めませんでした">
        {memberError.message}
      </Callout>
    );
  }

  const labs: LabOption[] = [];
  for (const m of memberships ?? []) {
    const embedded = m.laboratories as unknown;
    const lab = (Array.isArray(embedded) ? embedded[0] : embedded) as
      | { id: string; name: string }
      | null
      | undefined;
    if (lab) labs.push(lab);
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold text-ink">試薬・Lot</h1>
        <p className="mt-1 text-sm text-ink-2">
          ワークスペース単位で試薬・Lotの受領日・有効期限・保管条件を記録します。
        </p>
      </header>

      {labs.length === 0 ? (
        <Callout tone="warn" title="ワークスペースを準備できませんでした">
          ページを再読み込みしてください。
        </Callout>
      ) : (
        <ReagentManager labs={labs} />
      )}
    </div>
  );
}
