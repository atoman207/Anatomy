import { PageHeader } from "@/components/shell/PageHeader";
import { Callout } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { NewsManager } from "@/components/admin/NewsManager";
import { adminListNews } from "@/lib/news/actions";

export const dynamic = "force-dynamic";

/**
 * The announcements shown on the public landing page's news section.
 *
 * Platform-admin only, the same authority level as /admin/peer-review: this
 * is deployment-wide content, not something a lab manages for itself.
 */
export default async function AdminNewsPage() {
  await requirePlatformAdmin("/admin/news");
  const res = await adminListNews();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="お知らせ"
        description="トップページに表示するお知らせを作成・編集・削除します。"
      />
      {!res.ok ? (
        <Callout tone="danger" title="読み込みに失敗しました">
          {res.error}
          {res.error?.includes("site_news") && (
            <>
              {" "}
              <code className="font-mono text-[12px]">supabase/migrations/all.sql</code>{" "}
              の「Site news」の節を Supabase の SQL エディタで実行してください。
            </>
          )}
        </Callout>
      ) : (
        <NewsManager articles={res.data ?? []} />
      )}
    </div>
  );
}
