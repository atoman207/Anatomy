import { Badge, Card, DataTable, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/shell/PageHeader";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ACTION_TONE: Record<string, "good" | "warn" | "danger" | "neutral" | "accent"> = {
  "lab.created": "good",
  "lab.updated": "neutral",
  "lab.deleted": "danger",
  "lab.ownership_transferred": "warn",
  "member.added": "good",
  "member.invited": "accent",
  "member.removed": "danger",
  "member.role_changed": "warn",
  "user.created": "good",
  "user.deleted": "danger",
  "user.confirmed": "neutral",
  "user.password_reset_sent": "warn",
  "auth.sign_out": "neutral",
  "auth.password_changed": "warn",
  "profile.rename": "neutral",
};

/**
 * The audit trail.
 *
 * Append-only by policy: there is no update or delete policy on `audit_logs`,
 * so entries cannot be edited away, only read.
 */
export default async function AuditPage(props: PageProps<"/admin/audit">) {
  const ctx = await requireAdmin("/admin/audit");
  const search = await props.searchParams;
  const limit = Math.min(500, Math.max(25, Number(search.limit ?? 100) || 100));

  const admin = createAdminSupabase();
  let query = admin
    .from("audit_logs")
    .select("id, lab_id, user_id, action, entity, entity_id, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  // A lab admin sees only their laboratories; a platform admin sees everything,
  // including the platform-level entries that carry no lab id.
  if (!ctx.isPlatformAdmin) {
    const labIds = ctx.adminLabs.map((l) => l.labId);
    if (labIds.length === 0) {
      return <EmptyState title="監査対象の研究室がありません" />;
    }
    query = query.in("lab_id", labIds);
  }

  const { data: logs, error } = await query;
  if (error) {
    return <Card title="監査ログ">{error.message}</Card>;
  }

  const userIds = [...new Set((logs ?? []).map((l) => l.user_id).filter(Boolean))] as string[];
  const labIds = [...new Set((logs ?? []).map((l) => l.lab_id).filter(Boolean))] as string[];

  const { data: profiles } = userIds.length
    ? await admin.from("profiles").select("id, email").in("id", userIds)
    : { data: [] };
  const { data: labs } = labIds.length
    ? await admin.from("laboratories").select("id, name").in("id", labIds)
    : { data: [] };

  const userById = new Map((profiles ?? []).map((p) => [p.id, p.email ?? p.id]));
  const labById = new Map((labs ?? []).map((l) => [l.id, l.name]));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="監査ログ" description="管理操作の記録です。追記のみで、編集・削除はできません。" />
      <Card
      title="監査ログ"
      subtitle={`直近 ${logs?.length ?? 0} 件。追記のみ — 編集・削除はできません。`}
    >
      {(logs ?? []).length === 0 ? (
        <EmptyState title="まだ操作は記録されていません">
          管理操作は実行されるとここに表示されます。
        </EmptyState>
      ) : (
        <DataTable
          maxHeight="34rem"
          headers={["日時", "操作", "実行者", "研究室", "詳細"]}
          rows={(logs ?? []).map((l) => [
            <span key="t" className="whitespace-nowrap text-ink-3">
              {new Date(l.created_at).toLocaleString("ja-JP")}
            </span>,
            <Badge key="a" tone={ACTION_TONE[l.action] ?? "neutral"}>{l.action}</Badge>,
            <span key="u" className="font-mono text-ink-2">
              {l.user_id ? userById.get(l.user_id) ?? l.user_id.slice(0, 8) : "システム"}
            </span>,
            <span key="l" className="text-ink-2">
              {l.lab_id ? labById.get(l.lab_id) ?? "（削除済み）" : "—"}
            </span>,
            <span key="d" className="font-mono text-[10px] text-ink-3">
              {formatDetail(l.detail)}
            </span>,
          ])}
        />
      )}
    </Card>
    </div>
  );
}

function formatDetail(detail: unknown): string {
  if (!detail || typeof detail !== "object") return "";
  const entries = Object.entries(detail as Record<string, unknown>);
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" ");
}
