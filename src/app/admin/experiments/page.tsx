import { EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/shell/PageHeader";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminSupabase } from "@/lib/supabase/server";
import { AdminExperimentManager, type AdminExperimentRow } from "@/components/admin/AdminExperimentManager";

export const dynamic = "force-dynamic";

async function allLabs() {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("laboratories")
    .select("id, name")
    .order("created_at", { ascending: true });
  return data ?? [];
}

/**
 * Every experiment across every laboratory this admin may manage - the
 * cross-lab counterpart to `/experiments`, which a researcher uses for
 * their own labs only.
 */
export default async function AdminExperimentsPage() {
  const ctx = await requireAdmin("/admin/experiments");

  const labs = ctx.isPlatformAdmin
    ? await allLabs()
    : ctx.adminLabs.map((l) => ({ id: l.labId, name: l.labName }));

  if (labs.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="実験" description="研究室ごとのすべての実験を管理します。" />
        <EmptyState title="管理できる研究室がありません">
          先に「研究室」から研究室を作成してください。
        </EmptyState>
      </div>
    );
  }

  const admin = createAdminSupabase();
  const { data: experiments, error } = await admin
    .from("experiments")
    .select("*")
    .in("lab_id", labs.map((l) => l.id))
    .order("experiment_date", { ascending: false })
    .limit(200);

  const labById = new Map(labs.map((l) => [l.id, l.name]));
  const rows: AdminExperimentRow[] = (experiments ?? []).map((e) => ({
    ...e,
    lab_name: labById.get(e.lab_id) ?? "（不明）",
  }));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="実験" description="研究室ごとのすべての実験を作成・編集・削除します。" />
      {error ? (
        <p className="text-sm text-danger">{error.message}</p>
      ) : (
        <AdminExperimentManager labs={labs} experiments={rows} />
      )}
    </div>
  );
}
