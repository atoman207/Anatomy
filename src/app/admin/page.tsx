import Link from "next/link";
import { Badge, Callout, Card, EmptyState, StatTile } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminSupabase } from "@/lib/supabase/server";
import { LAB_ROLE_LABELS } from "@/lib/auth/roles";
import type { LabRole } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const ROLE_HINTS_JA: Record<LabRole, string> = {
  owner: "研究室の完全な管理権限。削除も可能。削除不可の役割。",
  admin: "メンバーとデータの管理。研究室の削除は不可。",
  member: "実験・データセット・ノートブックの作成・編集。",
  viewer: "研究室内のすべてを閲覧のみ。",
};

interface Counts {
  experiments: number;
  datasets: number;
  analyses: number;
  figures: number;
  notebook_entries: number;
  members: number;
}

/** Counts rows per table for the laboratories this admin can see. */
async function countsForLabs(labIds: string[]): Promise<Counts> {
  const empty: Counts = {
    experiments: 0, datasets: 0, analyses: 0, figures: 0,
    notebook_entries: 0, members: 0,
  };
  if (labIds.length === 0) return empty;

  const admin = createAdminSupabase();
  const tables = [
    "experiments", "datasets", "analyses", "figures", "notebook_entries", "lab_members",
  ] as const;

  const out = { ...empty };
  for (const t of tables) {
    const { count } = await admin
      .from(t)
      .select("lab_id", { count: "exact", head: true })
      .in("lab_id", labIds);
    if (t === "lab_members") out.members = count ?? 0;
    else out[t] = count ?? 0;
  }
  return out;
}

export default async function AdminOverviewPage(props: PageProps<"/admin">) {
  const ctx = await requireAdmin();
  const search = await props.searchParams;
  const denied = typeof search.denied === "string" ? search.denied : null;

  const visibleLabs = ctx.isPlatformAdmin ? await allLabs() : ctx.adminLabs;
  const counts = await countsForLabs(visibleLabs.map((l) => l.labId));

  const recent = await recentAudit(
    ctx.isPlatformAdmin ? null : visibleLabs.map((l) => l.labId),
  );

  return (
    <div className="flex flex-col gap-4">
      {denied === "platform" && (
        <Callout tone="warn" title="システム管理者専用">
          そのセクションはシステム管理者のみ利用できます。研究室の管理はこちらから行えます。
        </Callout>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="研究室" value={visibleLabs.length} tone="accent" />
        <StatTile label="メンバー" value={counts.members} />
        <StatTile label="実験" value={counts.experiments} />
        <StatTile label="データセット" value={counts.datasets} />
        <StatTile label="解析" value={counts.analyses} />
        <StatTile label="図" value={counts.figures} />
      </div>

      <Card
        title="あなたの権限"
        subtitle="研究室の役割はデータベースで強制されます。システム管理者権限はサーバー側で設定されます。"
      >
        {ctx.memberships.length === 0 ? (
          <EmptyState title="所属している研究室がありません">
            <Link href="/admin/labs" className="text-accent underline">
              研究室を作成
            </Link>
            してメンバーを招待してください。
          </EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {ctx.memberships.map((m) => (
              <li key={m.labId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{m.labName}</p>
                  <p className="text-xs text-ink-3">
                    {LAB_ROLE_LABELS[m.role].ja} — {ROLE_HINTS_JA[m.role]}
                  </p>
                </div>
                <Badge tone={m.role === "owner" ? "accent" : m.role === "admin" ? "good" : "neutral"}>
                  {LAB_ROLE_LABELS[m.role].ja}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {ctx.isPlatformAdmin && (
          <div className="mt-3">
            <Callout tone="info" title="システム管理者">
              あなたのメールアドレスは <code>PLATFORM_ADMIN_EMAILS</code> に登録されており、
              すべての研究室とユーザー管理にアクセスできます。サーバー専用の設定のため、
              ブラウザから変更することはできません。
            </Callout>
          </div>
        )}
      </Card>

      <Card
        title="最近の操作"
        subtitle="自動的に追記されます。編集・削除はできません。"
        actions={
          <Link href="/admin/audit" className="text-xs text-accent underline">
            すべて表示
          </Link>
        }
      >
        {recent.length === 0 ? (
          <EmptyState title="まだ操作は記録されていません" />
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)] text-xs">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-mono text-ink">{r.action}</span>
                <span className="text-ink-3">
                  {new Date(r.created_at).toLocaleString("ja-JP")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

async function allLabs() {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("laboratories")
    .select("id, name, description, owner_id")
    .order("created_at", { ascending: true });
  return (data ?? []).map((l) => ({
    labId: l.id,
    labName: l.name,
    labDescription: l.description,
    ownerId: l.owner_id,
    role: "admin" as const,
    joinedAt: "",
  }));
}

async function recentAudit(labIds: string[] | null) {
  const admin = createAdminSupabase();
  let query = admin
    .from("audit_logs")
    .select("id, action, created_at, lab_id")
    .order("created_at", { ascending: false })
    .limit(8);
  if (labIds) {
    if (labIds.length === 0) return [];
    query = query.in("lab_id", labIds);
  }
  const { data } = await query;
  return data ?? [];
}
