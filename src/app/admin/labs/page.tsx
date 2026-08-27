import { Badge, Card, DataTable, EmptyState, Field, TextInput } from "@/components/ui";
import { PageHeader } from "@/components/shell/PageHeader";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminSupabase } from "@/lib/supabase/server";
import { LAB_ROLE_LABELS } from "@/lib/auth/roles";
import type { LabRole } from "@/lib/supabase/types";
import { ActionForm, InlineActionForm } from "@/components/admin/ActionForm";
import { createLabAction, deleteLabAction } from "../actions";
import {
  effectivePlan, PLAN_BADGE_TONE, STATUS_LABELS, type PlanId,
} from "@/lib/billing/plans";
import { labHasPaymentHistory } from "@/lib/billing/paymentHistory";
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
  planId: PlanId;
  planName: string;
  status: BillingStatus | null;
  /** True when this free lab has no Stripe payment evidence and may be deleted. */
  canDelete: boolean;
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

    const plan = effectivePlan(
      sub?.plan as BillingPlan | null,
      sub?.status as BillingStatus | null,
    );
    const paymentBlock =
      plan.id === "free" ? await labHasPaymentHistory(l.id) : "有料プラン";
    const canDelete =
      plan.id === "free" &&
      !paymentBlock &&
      (ctx.isPlatformAdmin ||
        ctx.memberships.find((m) => m.labId === l.id)?.role === "owner" ||
        l.owner_id === ctx.user.id);

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
      planId: plan.id,
      planName: plan.name,
      status: (sub?.status as BillingStatus | null) ?? null,
      canDelete,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="研究室" description="研究室の一覧と削除を行います。" />
      <Card
        title={ctx.isPlatformAdmin ? "全研究室" : "研究室"}
        subtitle={`${views.length} 件 · 決済のない無料プランのみ削除できます`}
      >
        {views.length === 0 ? (
          <EmptyState title="まだ研究室がありません" />
        ) : (
          <DataTable
            headers={["名称", "オーナー", "プラン", "メンバー", "実験", "作成日", "あなたの役割", "操作"]}
            align={["left", "left", "left", "right", "right", "left", "left", "right"]}
            rows={views.map((v) => [
              <span key="n" className="font-medium text-ink">{v.name}</span>,
              <span key="o" className="font-mono text-ink-2">{v.ownerEmail}</span>,
              <span key="p" className="flex flex-wrap items-center gap-1.5">
                <Badge tone={PLAN_BADGE_TONE[v.planId]}>{v.planName}</Badge>
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
              v.canDelete ? (
                <InlineActionForm
                  key="d"
                  action={deleteLabAction}
                  hidden={{ lab_id: v.id, confirm: v.name }}
                  submitLabel="削除"
                  variant="danger"
                  confirm={`「${v.name}」とすべてのデータを永久に削除しますか？決済のない無料プランのみ削除できます。`}
                />
              ) : (
                <span key="d" className="text-ink-3">—</span>
              ),
            ])}
          />
        )}
      </Card>
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
