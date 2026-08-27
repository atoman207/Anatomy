import Link from "next/link";
import {
  Badge, Callout, Card, DataTable, EmptyState, Field, Select, StatTile, TextArea, TextInput,
} from "@/components/ui";
import { PageHeader } from "@/components/shell/PageHeader";
import { LabSelector } from "@/components/labs/LabSelector";
import { ExperimentCreator, type LabOption } from "@/components/ExperimentCreator";
import { requireUser } from "@/lib/auth/guards";
import { createAdminSupabase, createServerSupabase } from "@/lib/supabase/server";
import { LAB_ROLE_LABELS, canManageMembers, canWrite } from "@/lib/auth/roles";
import type { ExperimentStatus, LabRole } from "@/lib/supabase/types";
import { ActionForm, InlineActionForm } from "@/components/admin/ActionForm";
import { InviteEmailInput } from "@/components/admin/InviteEmailInput";
import {
  cancelLabInviteAction,
  changeLabMemberRoleAction,
  createLabAction,
  deleteExperimentAction,
  deleteLabAction,
  inviteLabMemberAction,
  removeLabMemberAction,
  transferLabOwnershipAction,
  updateLabAction,
} from "@/lib/labs/actions";

export const dynamic = "force-dynamic";

interface LabSummary {
  labId: string;
  labName: string;
  labDescription: string | null;
  ownerId: string;
  role: LabRole;
  memberCount: number;
  experimentCount: number;
}

interface MemberRow {
  userId: string;
  email: string;
  displayName: string;
  role: LabRole;
  joinedAt: string;
}

interface PendingInvite {
  id: string;
  email: string;
  role: LabRole;
  createdAt: string;
}

interface ExperimentRow {
  id: string;
  name: string;
  experimentDate: string;
  operator: string | null;
  status: ExperimentStatus;
  notebookCount: number;
  createdBy: string | null;
  labId: string;
}

const STATUS_LABELS: Record<ExperimentStatus, string> = {
  planned: "計画",
  in_progress: "進行中",
  complete: "完了",
  archived: "アーカイブ",
};

const STATUS_TONE: Record<ExperimentStatus, "good" | "warn" | "accent" | "neutral"> = {
  planned: "accent",
  in_progress: "warn",
  complete: "good",
  archived: "neutral",
};

export default async function LabsPage(props: PageProps<"/labs">) {
  const [ctx, search] = await Promise.all([requireUser("/labs"), props.searchParams]);
  const supabase = await createServerSupabase();

  const summaries: LabSummary[] = [];
  for (const m of ctx.memberships) {
    const isCreator = m.ownerId === ctx.user.id;
    const [memberCountRes, experimentCountRes] = await Promise.all([
      supabase.from("lab_members").select("user_id", { count: "exact", head: true }).eq("lab_id", m.labId),
      isCreator
        ? supabase.from("experiments").select("id", { count: "exact", head: true }).eq("lab_id", m.labId)
        : supabase
            .from("experiments")
            .select("id", { count: "exact", head: true })
            .eq("lab_id", m.labId)
            .eq("created_by", ctx.user.id),
    ]);
    summaries.push({
      labId: m.labId,
      labName: m.labName,
      labDescription: m.labDescription,
      ownerId: m.ownerId,
      role: m.role,
      memberCount: memberCountRes.count ?? 0,
      experimentCount: experimentCountRes.count ?? 0,
    });
  }

  const requestedLab = typeof search.lab === "string" ? search.lab : null;
  const selected =
    summaries.find((s) => s.labId === requestedLab) ?? summaries[0] ?? null;

  let roster: MemberRow[] = [];
  let invites: PendingInvite[] = [];
  let experiments: ExperimentRow[] = [];

  if (selected) {
    const admin = createAdminSupabase();

    const { data: members } = await admin
      .from("lab_members")
      .select("user_id, role, joined_at")
      .eq("lab_id", selected.labId)
      .order("joined_at", { ascending: true });

    const memberIds = (members ?? []).map((mm) => mm.user_id);
    const { data: profiles } = memberIds.length
      ? await admin.from("profiles").select("id, email, display_name").in("id", memberIds)
      : { data: [] as { id: string; email: string | null; display_name: string | null }[] };
    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

    roster = (members ?? []).map((mm) => ({
      userId: mm.user_id,
      email: byId.get(mm.user_id)?.email ?? "（不明）",
      displayName: byId.get(mm.user_id)?.display_name ?? "ユーザー",
      role: mm.role as LabRole,
      joinedAt: mm.joined_at,
    }));

    if (canManageMembers(selected.role)) {
      const { data: pendingInvites } = await admin
        .from("lab_invites")
        .select("id, email, role, created_at")
        .eq("lab_id", selected.labId)
        .is("accepted_at", null)
        .order("created_at", { ascending: true });

      invites = (pendingInvites ?? []).map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role as LabRole,
        createdAt: i.created_at,
      }));
    }

    const isLabCreator = selected.ownerId === ctx.user.id;
    let expQuery = supabase
      .from("experiments")
      .select("id, name, experiment_date, operator, status, created_by")
      .eq("lab_id", selected.labId)
      .order("experiment_date", { ascending: false });
    if (!isLabCreator) {
      expQuery = expQuery.eq("created_by", ctx.user.id);
    }
    const { data: expRows } = await expQuery;

    const expIds = (expRows ?? []).map((e) => e.id);
    const notebookCounts = new Map<string, number>();
    if (expIds.length > 0) {
      const { data: entries } = await supabase
        .from("notebook_entries")
        .select("experiment_id")
        .in("experiment_id", expIds);
      for (const row of entries ?? []) {
        notebookCounts.set(row.experiment_id, (notebookCounts.get(row.experiment_id) ?? 0) + 1);
      }
    }

    experiments = (expRows ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      experimentDate: e.experiment_date,
      operator: e.operator,
      status: e.status as ExperimentStatus,
      notebookCount: notebookCounts.get(e.id) ?? 0,
      createdBy: e.created_by,
      labId: selected.labId,
    }));
  }

  const inProgress = experiments.filter((e) => e.status === "in_progress");
  const canManage = selected ? canManageMembers(selected.role) : false;
  const canInvite = selected ? canWrite(selected.role) : false;
  const currentUserId = ctx.user.id;
  const isLabCreator = selected ? selected.ownerId === currentUserId : false;
  const labForCreator: LabOption[] = selected
    ? [{ id: selected.labId, name: selected.labName, description: selected.labDescription, role: selected.role }]
    : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="研究室"
        description="共同研究のための研究室です。研究室を選ぶと、実験・メンバー・設定をこのページで確認できます。"
      />

      <Card title="研究室を作成" subtitle="誰でも作成できます。作成すると、あなたがオーナーになります。">
        <ActionForm action={createLabAction} submitLabel="作成" icon="plus">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="名称" htmlFor="lab-name">
              <TextInput id="lab-name" name="name" required placeholder="例: 軟骨再生研究室" />
            </Field>
            <Field label="説明" htmlFor="lab-desc">
              <TextInput id="lab-desc" name="description" placeholder="任意" />
            </Field>
          </div>
        </ActionForm>
      </Card>

      {summaries.length === 0 ? (
        <EmptyState title="まだ研究室に参加していません">
          上のフォームで作成するか、オーナーに招待を依頼してください。
        </EmptyState>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-ink-2">研究室を選択</h2>
            <LabSelector
              labs={summaries.map((s) => ({
                id: s.labId,
                name: s.labName,
                experimentCount: s.experimentCount,
                isOwner: s.role === "owner",
              }))}
              current={selected!.labId}
            />
          </section>

          {selected && (
            <div className="flex flex-col gap-6">
              <Card
                title={selected.labName}
                subtitle={selected.labDescription ?? undefined}
                actions={
                  <Badge tone={selected.role === "owner" ? "accent" : selected.role === "admin" ? "good" : "neutral"}>
                    {LAB_ROLE_LABELS[selected.role].ja}
                  </Badge>
                }
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  <StatTile label="メンバー" value={`${selected.memberCount} 名`} />
                  <StatTile label="実験" value={`${selected.experimentCount} 件`} tone="accent" />
                  <StatTile
                    label="進行中"
                    value={`${inProgress.length} 件`}
                    tone={inProgress.length > 0 ? "warn" : undefined}
                    hint="現在進行中の実験"
                  />
                </div>
              </Card>

              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold text-ink-2">実験</h2>
                <ExperimentCreator labs={labForCreator} />
                {experiments.length === 0 ? (
                  <EmptyState title="この研究室にはまだ実験がありません">
                    上のフォームで最初の実験を作成してください。
                  </EmptyState>
                ) : (
                  <>
                    {inProgress.length > 0 && (
                      <Card title={`進行中の実験（${inProgress.length} 件）`}>
                        <ExperimentTable
                          experiments={inProgress}
                          currentUserId={currentUserId}
                          isLabCreator={isLabCreator}
                        />
                      </Card>
                    )}
                    <Card title={`すべての実験（${experiments.length} 件）`}>
                      <ExperimentTable
                        experiments={experiments}
                        currentUserId={currentUserId}
                        isLabCreator={isLabCreator}
                      />
                    </Card>
                  </>
                )}
              </section>

              <Card title={`メンバー（${roster.length} 名）`}>
                <DataTable
                  headers={["名前", "メール", "役割", "参加日", ...(canManage ? ["操作"] : [])]}
                  rows={roster.map((m) => [
                    <span key="n" className="text-ink">
                      {m.displayName}
                      {m.userId === ctx.user.id && (
                        <span className="ml-1.5 text-[10px] text-ink-3">（あなた）</span>
                      )}
                    </span>,
                    <span key="e" className="font-mono text-ink-2">{m.email}</span>,
                    <Badge
                      key="r"
                      tone={m.role === "owner" ? "accent" : m.role === "admin" ? "good" : "neutral"}
                    >
                      {LAB_ROLE_LABELS[m.role].ja}
                    </Badge>,
                    new Date(m.joinedAt).toLocaleDateString("ja-JP"),
                    ...(canManage
                      ? [
                          m.role === "owner" || m.userId === ctx.user.id ? (
                            <span key="o" className="text-ink-3">
                              {m.role === "owner" ? "オーナー — 下で譲渡" : "自分自身"}
                            </span>
                          ) : (
                            <div key="ops" className="flex flex-nowrap items-center gap-2">
                              <InlineActionForm
                                action={changeLabMemberRoleAction}
                                hidden={{ lab_id: selected.labId, user_id: m.userId }}
                                submitLabel="変更"
                                icon="save"
                                iconOnly
                              >
                                <select
                                  name="role"
                                  defaultValue={m.role}
                                  aria-label={`${m.email} の役割`}
                                  className="h-8 w-[6.75rem] rounded-md border border-line-strong bg-surface-1 px-2 text-[12px] leading-none text-ink"
                                >
                                  {(["admin", "member", "viewer"] as LabRole[]).map((r) => (
                                    <option key={r} value={r}>{LAB_ROLE_LABELS[r].ja}</option>
                                  ))}
                                </select>
                              </InlineActionForm>
                              <InlineActionForm
                                action={removeLabMemberAction}
                                hidden={{ lab_id: selected.labId, user_id: m.userId }}
                                submitLabel="削除"
                                variant="danger"
                                iconOnly
                                confirm={`${m.email} を「${selected.labName}」から削除しますか？データは研究室に残ります。`}
                              />
                            </div>
                          ),
                        ]
                      : []),
                  ])}
                />
              </Card>

              {canInvite && (
                <Card
                  title="メンバーを招待"
                  subtitle="この研究室のメンバーなら誰でも、新しい仲間を招待できます。"
                >
                  <div className="flex flex-col gap-6">
                    {canManage && invites.length > 0 && (
                      <div>
                        <h3 className="mb-2 text-xs font-semibold text-ink-2">招待中（{invites.length} 件）</h3>
                        <DataTable
                          headers={["メール", "役割", "招待日", "操作"]}
                          rows={invites.map((inv) => [
                            <span key="e" className="font-mono text-ink-2">{inv.email}</span>,
                            <Badge key="r" tone="neutral">{LAB_ROLE_LABELS[inv.role].ja}</Badge>,
                            new Date(inv.createdAt).toLocaleDateString("ja-JP"),
                            <InlineActionForm
                              key="c"
                              action={cancelLabInviteAction}
                              hidden={{ lab_id: selected.labId, invite_id: inv.id }}
                              submitLabel="取り消し"
                              variant="danger"
                            />,
                          ])}
                        />
                      </div>
                    )}

                    <div>
                      <ActionForm
                        action={inviteLabMemberAction}
                        hidden={{ lab_id: selected.labId }}
                        submitLabel="招待"
                        icon="plus"
                      >
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label="メールアドレス" hint="アカウントがない場合は招待メールを送ります。">
                            <InviteEmailInput name="email" />
                          </Field>
                          <Field label="権限" hint="実験・データセット・ノートブックの作成・編集。">
                            <Select name="role" defaultValue="member">
                              {(canManage ? (["admin", "member", "viewer"] as LabRole[]) : (["member", "viewer"] as LabRole[])).map((r) => (
                                <option key={r} value={r}>{LAB_ROLE_LABELS[r].ja}</option>
                              ))}
                            </Select>
                          </Field>
                        </div>
                      </ActionForm>
                    </div>
                  </div>
                </Card>
              )}

              {canManage && (
                <Card
                  title="管理"
                  subtitle="権限・研究室の設定を行います。"
                >
                  <div className="flex flex-col gap-6">
                    <div>
                      <h3 className="mb-2 text-xs font-semibold text-ink-2">研究室の設定</h3>
                      <ActionForm
                        action={updateLabAction}
                        hidden={{ lab_id: selected.labId }}
                        submitLabel="保存"
                        icon="save"
                      >
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label="名称">
                            <TextInput name="name" defaultValue={selected.labName} required />
                          </Field>
                          <Field label="説明">
                            <TextArea name="description" defaultValue={selected.labDescription ?? ""} />
                          </Field>
                        </div>
                      </ActionForm>
                    </div>

                    {selected.role === "owner" && roster.length > 1 && (
                      <div>
                        <h3 className="mb-2 text-xs font-semibold text-ink-2">オーナーの譲渡</h3>
                        <ActionForm
                          action={transferLabOwnershipAction}
                          hidden={{ lab_id: selected.labId }}
                          submitLabel="譲渡"
                          variant="danger"
                          confirm={`「${selected.labName}」のオーナー権限を譲渡しますか？`}
                          icon="arrow"
                        >
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="新しいオーナー">
                              <Select name="user_id" required>
                                {roster.filter((m) => m.role !== "owner").map((m) => (
                                  <option key={m.userId} value={m.userId}>
                                    {m.displayName} ({m.email})
                                  </option>
                                ))}
                              </Select>
                            </Field>
                            <Field label="確認" hint="「譲渡」と正確に入力してください。">
                              <TextInput name="confirm" required placeholder="譲渡" />
                            </Field>
                          </div>
                        </ActionForm>
                      </div>
                    )}

                    {selected.role === "owner" && (
                      <div>
                        <h3 className="mb-2 text-xs font-semibold text-ink-2">研究室の削除</h3>
                        <Callout tone="danger" title="取り消せません">
                          研究室を削除するとすべてのデータが永久に失われます。必要なデータは事前にエクスポートしてください。
                        </Callout>
                        <div className="mt-3">
                          <ActionForm
                            action={deleteLabAction}
                            hidden={{ lab_id: selected.labId }}
                            submitLabel="削除"
                            variant="danger"
                            confirm={`「${selected.labName}」とすべてのデータを永久に削除しますか？`}
                          >
                            <Field label="確認" hint={`名称を正確に入力: ${selected.labName}`}>
                              <TextInput name="confirm" required placeholder={selected.labName} />
                            </Field>
                          </ActionForm>
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ExperimentTable({
  experiments,
  currentUserId,
  isLabCreator,
}: {
  experiments: ExperimentRow[];
  currentUserId: string;
  isLabCreator: boolean;
}) {
  return (
    <ul className="flex flex-col divide-y divide-[var(--border)]">
      {experiments.map((e) => {
        const isMine = e.createdBy === currentUserId;
        const canDelete = isMine;
        return (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">
                {e.name}
                {isLabCreator && !isMine && (
                  <span className="ml-1.5 text-[10px] font-normal text-ink-3">（他メンバー・閲覧のみ）</span>
                )}
              </p>
              <p className="text-xs text-ink-3">
                {e.experimentDate}
                {e.operator ? ` · ${e.operator}` : ""}
                {e.notebookCount > 0 ? ` · ノート ${e.notebookCount} 件` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge tone={STATUS_TONE[e.status]}>{STATUS_LABELS[e.status]}</Badge>
              {isMine ? (
                <Link
                  href="/record?step=4"
                  className="text-[11px] text-accent underline underline-offset-2"
                >
                  ノートを書く
                </Link>
              ) : isLabCreator ? (
                <Link
                  href={`/record?step=4&lab=${encodeURIComponent(e.labId)}&experiment=${encodeURIComponent(e.id)}`}
                  className="text-[11px] text-ink-3 underline underline-offset-2"
                  title="閲覧のみ。編集はできません。"
                >
                  ノートを確認
                </Link>
              ) : null}
              {canDelete && (
                <InlineActionForm
                  action={deleteExperimentAction}
                  hidden={{ experiment_id: e.id }}
                  submitLabel="削除"
                  variant="danger"
                  iconOnly
                  confirm={`「${e.name}」を削除しますか？関連するノートは削除されますが、試薬カタログは研究室に残ります。`}
                />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
