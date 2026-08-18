import Link from "next/link";
import { Badge, Callout, Card, EmptyState } from "@/components/ui";
import { createServerSupabase, getCurrentUser, isSupabaseConfigured } from "@/lib/supabase/server";
import { ExperimentCreator, type LabOption } from "@/components/ExperimentCreator";

export const dynamic = "force-dynamic";

export default async function ExperimentsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <Callout tone="info" title="Supabaseが設定されていません">
        実験を保存するには、プロジェクトURLとキーを <code>.env.local</code> に追加してください。データ整理、統計解析、実験ノートは設定なしでも使えます。
      </Callout>
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-ink">実験一覧</h1>
        <Callout tone="info" title="実験を保存するにはログインしてください">
          <Link href="/login" className="text-accent underline">ログイン</Link>
          すると、実験・ノート・図を保存できます。それ以外は未ログインでも使えます。
        </Callout>
      </div>
    );
  }

  const supabase = await createServerSupabase();

  const { data: memberships, error: memberError } = await supabase
    .from("lab_members")
    .select("lab_id, role, laboratories(id, name, description)")
    .order("joined_at", { ascending: true });

  if (memberError) {
    return (
      <Callout tone="danger" title="研究室を読み込めませんでした">
        {memberError.message}
        {/relation|does not exist|Could not find the table/i.test(memberError.message) && (
          <p className="mt-1.5">
            スキーマがまだ適用されていません。<code>npm run db:push</code> を実行してください。
          </p>
        )}
      </Callout>
    );
  }

  const labs: LabOption[] = [];
  for (const m of memberships ?? []) {
    // The embedded relation arrives as an object (or array, depending on the
    // inferred cardinality); normalize both shapes.
    const embedded = m.laboratories as unknown;
    const lab = (Array.isArray(embedded) ? embedded[0] : embedded) as
      | { id: string; name: string; description: string | null }
      | null
      | undefined;
    if (lab) labs.push({ ...lab, role: String(m.role) });
  }

  const { data: experiments } = await supabase
    .from("experiments")
    .select("id, name, experiment_date, operator, status, lab_id")
    .order("experiment_date", { ascending: false })
    .limit(100);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">実験一覧</h1>
          <p className="mt-1 text-sm text-ink-2">
            {user.email} としてログイン中
          </p>
        </div>
      </header>

      <ExperimentCreator labs={labs} />

      {labs.length === 0 ? (
        <EmptyState title="研究室がまだありません">
          上で研究室を作成すると、実験の記録を始められます。
        </EmptyState>
      ) : (experiments ?? []).length === 0 ? (
        <EmptyState title="実験はまだありません">
          上で最初の実験を作成してください。
        </EmptyState>
      ) : (
        <Card title={`実験 ${experiments!.length} 件`}>
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {experiments!.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{e.name}</p>
                  <p className="text-xs text-ink-3">
                    {e.experiment_date}
                    {e.operator ? ` · ${e.operator}` : ""}
                    {" · "}
                    {labs.find((l) => l.id === e.lab_id)?.name ?? "—"}
                  </p>
                </div>
                <Badge
                  tone={
                    e.status === "complete" ? "good"
                      : e.status === "archived" ? "neutral"
                        : e.status === "planned" ? "accent" : "warn"
                  }
                >
                  {e.status === "complete" ? "完了"
                    : e.status === "archived" ? "アーカイブ"
                      : e.status === "planned" ? "計画"
                        : e.status === "in_progress" ? "進行中"
                          : e.status}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
