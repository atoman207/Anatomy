import Link from "next/link";
import { Suspense } from "react";
import { Callout } from "@/components/ui";
import { createServerSupabase, getCurrentUser, isSupabaseConfigured } from "@/lib/supabase/server";
import { ReportWizard } from "@/components/report/ReportWizard";
import type { LabOption } from "@/components/reagents/ReagentManager";

export const dynamic = "force-dynamic";

/**
 * The single 実験記録 flow: pick/create today's experiment, log reagents,
 * capture a voice memo, compile the notebook entry (with AI help and
 * chart/image inserts), optionally attach literature, then finish - which
 * saves the entry and produces a PDF. Replaces the five separate 記録 pages.
 */
export default async function RecordPage() {
  if (!isSupabaseConfigured()) {
    return (
      <Callout tone="info" title="実験記録は現在利用できません">
        管理者にお問い合わせください。
      </Callout>
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-ink">実験記録</h1>
        <Callout tone="info" title="ログインしてください">
          <Link href="/login" className="text-accent underline">ログイン</Link>
          すると、実験を記録できます。
        </Callout>
      </div>
    );
  }

  const { ensurePersonalLab } = await import("@/lib/labs/personalLab");
  const displayName =
    (user.user_metadata?.display_name as string | undefined) || user.email?.split("@")[0] || "個人";
  await ensurePersonalLab(user.id, displayName);

  const supabase = await createServerSupabase();
  const { data: memberships, error: memberError } = await supabase
    .from("lab_members")
    .select("lab_id, laboratories(id, name)")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true });

  if (memberError) {
    return (
      <Callout tone="danger" title="ワークスペースを読み込めませんでした">
        {memberError.message}
      </Callout>
    );
  }

  const labs: LabOption[] = [];
  const seen = new Set<string>();
  for (const m of memberships ?? []) {
    const embedded = m.laboratories as unknown;
    const lab = (Array.isArray(embedded) ? embedded[0] : embedded) as
      | { id: string; name: string }
      | null
      | undefined;
    if (!lab || seen.has(lab.id)) continue;
    seen.add(lab.id);
    labs.push(lab);
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold text-ink">実験記録</h1>
        <p className="mt-1 text-sm text-ink-2">
          実験の選択から試薬・音声メモ・実験ノート・論文検索までを1つの流れで記録します。最後まで進むと保存され、PDFが作成されます。
        </p>
      </header>

      {labs.length === 0 ? (
        <Callout tone="warn" title="ワークスペースを準備できませんでした">
          ページを再読み込みしてください。
        </Callout>
      ) : (
        <Suspense fallback={<p className="text-sm text-ink-3">読み込み中…</p>}>
          <ReportWizard labs={labs} />
        </Suspense>
      )}
    </div>
  );
}
