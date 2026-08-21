import { PageHeader } from "@/components/shell/PageHeader";
import { Callout } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { createAdminSupabase } from "@/lib/supabase/server";
import { AdminContentManager } from "@/components/admin/AdminContentManager";
import { adminContentUsage } from "./contentActions";

export const dynamic = "force-dynamic";

/**
 * Every laboratory's content, in one place: browse, count, and delete.
 *
 * Platform-admin only - this reaches across every laboratory on the
 * deployment, unlike `/admin/experiments` and `/admin/templates`, which a
 * lab admin can also reach for their own lab. Two of the eleven content
 * types are ordinarily append-only for everyone, including lab owners;
 * deleting one here is a deliberate, audited override of that guarantee -
 * see `contentActions.ts` for exactly how and why that is safe to allow only
 * from this page.
 */
export default async function AdminContentPage() {
  await requirePlatformAdmin("/admin/content");

  const admin = createAdminSupabase();
  const [{ data: labs }, usageResult] = await Promise.all([
    admin.from("laboratories").select("id, name").order("name", { ascending: true }),
    adminContentUsage(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="コンテンツ管理"
        description="研究室が作成したデータを横断的に検索・集計・削除します。"
      />
      {!usageResult.ok && (
        <Callout tone="danger" title="集計に失敗しました">{usageResult.error}</Callout>
      )}
      <AdminContentManager labs={labs ?? []} usage={usageResult.data ?? []} />
    </div>
  );
}
