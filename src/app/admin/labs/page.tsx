import { Badge, Callout, Card, DataTable, EmptyState, Field, TextArea, TextInput } from "@/components/ui";
import { PageHeader } from "@/components/shell/PageHeader";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminSupabase } from "@/lib/supabase/server";
import { LAB_ROLE_LABELS } from "@/lib/auth/roles";
import type { LabRole } from "@/lib/supabase/types";
import { ActionForm } from "@/components/admin/ActionForm";
import { createLabAction, updateLabAction, deleteLabAction } from "../actions";
import { effectivePlan, STATUS_LABELS } from "@/lib/billing/plans";
import type { BillingPlan, BillingStatus } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

interface LabView {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  ownerEmail: string;
  memberCount: number;
  experimentCount: number;
  createdAt: string;
  myRole: string | null;
  /** The plan in force, and the raw Stripe status behind it. */
  planName: string;
  status: BillingStatus | null;
}

export default async function LabsPage() {
  const ctx = await requireAdmin("/admin/labs");
  const admin = createAdminSupabase();

  const scope = ctx.isPlatformAdmin ? null : ctx.memberships.map((m) => m.labId);

  let query = admin
    .from("laboratories")
    .select("id, name, description, owner_id, created_at")
    .order("created_at", { ascending: true });
  if (scope) {
    if (scope.length === 0) {
      return <NoLabs />;
    }
    query = query.in("id", scope);
  }
  const { data: labs } = await query;

  const views: LabView[] = [];
  for (const l of labs ?? []) {
    const { count: memberCount } = await admin
      .from("lab_members").select("user_id", { count: "exact", head: true }).eq("lab_id", l.id);
    const { count: experimentCount } = await admin
      .from("experiments").select("id", { count: "exact", head: true }).eq("lab_id", l.id);
    const { data: owner } = await admin
      .from("profiles").select("email").eq("id", l.owner_id).maybeSingle();
    const { data: sub } = await admin
      .from("lab_subscriptions").select("plan, status").eq("lab_id", l.id).maybeSingle();

    views.push({
      id: l.id,
      name: l.name,
      description: l.description,
      ownerId: l.owner_id,
      ownerEmail: owner?.email ?? "（不明）",
      memberCount: memberCount ?? 0,
      experimentCount: experimentCount ?? 0,
      createdAt: l.created_at,
      myRole: ctx.memberships.find((m) => m.labId === l.id)?.role ?? null,
      planName: effectivePlan(sub?.plan as BillingPlan | null, sub?.status as BillingStatus | null).name,
      status: (sub?.status as BillingStatus | null) ?? null,
    });
  }

  const ownedByMe = views.filter(
    (v) => v.myRole === "owner" || (ctx.isPlatformAdmin && v.ownerId === ctx.user.id),
  );
  const editable = views.filter(
    (v) => ctx.isPlatformAdmin || v.myRole === "owner" || v.myRole === "admin",
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="研究室" description="研究室の作成・設定・削除を行います。" />
      <Card
        title={ctx.isPlatformAdmin ? "全研究室" : "研究室"}
        subtitle={`${views.length} 件`}
      >
        {views.length === 0 ? (
          <EmptyState title="まだ研究室がありません" />
        ) : (
          <DataTable
            headers={["名称", "オーナー", "プラン", "メンバー", "実験", "作成日", "あなたの役割"]}
            align={["left", "left", "left", "right", "right", "left", "left"]}
            rows={views.map((v) => [
              <span key="n" className="font-medium text-ink">{v.name}</span>,
              <span key="o" className="font-mono text-ink-2">{v.ownerEmail}</span>,
              <span key="p" className="flex flex-wrap items-center gap-1.5">
                <Badge tone={v.planName === "個人研究者" ? "neutral" : "accent"}>{v.planName}</Badge>
                {v.status && v.status !== "active" && (
                  <Badge tone={STATUS_LABELS[v.status].tone}>{STATUS_LABELS[v.status].ja}</Badge>
                )}
              </span>,
              v.memberCount,
              v.experimentCount,
              new Date(v.createdAt).toLocaleDateString("ja-JP"),
              v.myRole ? (
                <Badge key="r" tone={v.myRole === "owner" ? "accent" : "neutral"}>
                  {LAB_ROLE_LABELS[v.myRole as LabRole].ja}
                </Badge>
              ) : (
                <span key="r" className="text-ink-3">非メンバー</span>
              ),
            ])}
          />
        )}
      </Card>

      <Card
        title="研究室を作成"
        subtitle="作成者がオーナーになります。"
      >
        <ActionForm action={createLabAction} submitLabel="作成" icon="plus">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="名称" htmlFor="lab-name">
              <TextInput id="lab-name" name="name" required />
            </Field>
            <Field label="説明" htmlFor="lab-desc">
              <TextInput id="lab-desc" name="description" placeholder="任意" />
            </Field>
          </div>
        </ActionForm>
      </Card>

      {editable.map((v) => (
        <Card key={v.id} title={`設定 — ${v.name}`}>
          <ActionForm action={updateLabAction} hidden={{ lab_id: v.id }} submitLabel="保存" icon="save">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="名称">
                <TextInput name="name" defaultValue={v.name} required />
              </Field>
              <Field label="説明">
                <TextArea name="description" defaultValue={v.description ?? ""} />
              </Field>
            </div>
          </ActionForm>
        </Card>
      ))}

      {ownedByMe.length > 0 && (
        <Card
          title="研究室の削除"
          subtitle="オーナーのみ。すべてのデータが削除されます。"
        >
          <Callout tone="danger" title="取り消せません">
            研究室を削除するとすべてのデータが永久に失われます。必要なデータは事前にエクスポートしてください。
          </Callout>
          <div className="mt-3 flex flex-col gap-4">
            {ownedByMe.map((v) => (
              <div key={v.id} className="rounded-lg border border-line p-3">
                <p className="mb-2 text-xs text-ink-2">
                  <strong className="text-ink">{v.name}</strong> — メンバー {v.memberCount} 名、
                  実験 {v.experimentCount} 件
                </p>
                <ActionForm
                  action={deleteLabAction}
                  hidden={{ lab_id: v.id }}
                  submitLabel="削除"
                  variant="danger"
                  confirm={`「${v.name}」とすべてのデータを永久に削除しますか？`}
                >
                  <Field label="確認" hint={`名称を正確に入力: ${v.name}`}>
                    <TextInput name="confirm" required placeholder={v.name} />
                  </Field>
                </ActionForm>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function NoLabs() {
  return (
    <div className="flex flex-col gap-4">
      <EmptyState title="研究室がありません">
        下から作成して実験の記録を始めてください。
      </EmptyState>
      <Card title="研究室を作成">
        <ActionForm action={createLabAction} submitLabel="作成" icon="plus">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="名称">
              <TextInput name="name" required />
            </Field>
            <Field label="説明">
              <TextInput name="description" placeholder="任意" />
            </Field>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
