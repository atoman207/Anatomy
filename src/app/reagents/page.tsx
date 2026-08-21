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
          すると、試薬・Lotを研究室ごとに記録できます。
        </Callout>
      </div>
    );
  }

  const supabase = await createServerSupabase();
  const { data: memberships, error: memberError } = await supabase
    .from("lab_members")
    .select("lab_id, laboratories(id, name)")
    .order("joined_at", { ascending: true });

  if (memberError) {
    return (
      <Callout tone="danger" title="研究室を読み込めませんでした">
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
          研究室単位で試薬・Lotの受領日・有効期限・保管条件を記録します。
        </p>
      </header>

      {labs.length === 0 ? (
        <Callout tone="info" title="研究室がまだありません">
          <Link href="/experiments" className="text-accent underline">実験一覧</Link>
          で研究室を作成してください。
        </Callout>
      ) : (
        <ReagentManager labs={labs} />
      )}
    </div>
  );
}
