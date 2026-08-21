import { PageHeader } from "@/components/shell/PageHeader";
import { requireAdmin } from "@/lib/auth/guards";
import { AdminTemplateManager } from "@/components/admin/AdminTemplateManager";
import { createAdminSupabase } from "@/lib/supabase/server";
import { adminListTemplates } from "../templateActions";

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
 * Every custom notebook template, across every laboratory this admin may
 * manage. Built-in templates ship with the app and are not listed here -
 * there is nothing to moderate about code that ships in the repository.
 */
export default async function AdminTemplatesPage() {
  const ctx = await requireAdmin("/admin/templates");

  const labIds = ctx.isPlatformAdmin ? null : ctx.adminLabs.map((l) => l.labId);
  const [res, labs] = await Promise.all([
    adminListTemplates(labIds),
    ctx.isPlatformAdmin
      ? allLabs()
      : Promise.resolve(ctx.adminLabs.map((l) => ({ id: l.labId, name: l.labName }))),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="テンプレート"
        description="研究者が作成したカスタムテンプレートを作成・確認・編集・削除します。"
      />
      {!res.ok ? (
        <p className="text-sm text-danger">{res.error}</p>
      ) : (
        <AdminTemplateManager templates={res.data ?? []} labs={labs} />
      )}
    </div>
  );
}
