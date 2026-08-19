import { Badge, Callout, Card, EmptyState, Field, Select, TextInput } from "@/components/ui";
import { PageHeader } from "@/components/shell/PageHeader";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminSupabase } from "@/lib/supabase/server";
import { LAB_ROLE_LABELS } from "@/lib/auth/roles";
import type { LabRole } from "@/lib/supabase/types";
import { ActionForm, InlineActionForm } from "@/components/admin/ActionForm";
import {
  addMemberAction, changeMemberRoleAction, removeMemberAction, transferOwnershipAction,
} from "../actions";
import { LabPicker } from "@/components/admin/LabPicker";

export const dynamic = "force-dynamic";

interface MemberRow {
  userId: string;
  email: string;
  displayName: string;
  role: LabRole;
  joinedAt: string;
  confirmed: boolean;
  lastSignIn: string | null;
}

/**
 * Members of one laboratory, with their auth details.
 *
 * Profile rows are readable only by their owner under RLS, so the roster is
 * assembled with the service-role client after the caller's right to manage
 * this laboratory has already been established by the layout guard.
 */
async function loadMembers(labId: string): Promise<MemberRow[]> {
  const admin = createAdminSupabase();

  const { data: members } = await admin
    .from("lab_members")
    .select("user_id, role, joined_at")
    .eq("lab_id", labId)
    .order("joined_at", { ascending: true });

  if (!members || members.length === 0) return [];

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, display_name")
    .in("id", members.map((m) => m.user_id));
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  const rows: MemberRow[] = [];
  for (const m of members) {
    const profile = byId.get(m.user_id);
    // getUserById fills in confirmation and last sign-in, which the profiles
    // table does not carry.
    const { data: authUser } = await admin.auth.admin.getUserById(m.user_id);
    rows.push({
      userId: m.user_id,
      email: profile?.email ?? authUser.user?.email ?? "（不明）",
      displayName: profile?.display_name ?? authUser.user?.email?.split("@")[0] ?? "ユーザー",
      role: m.role as LabRole,
      joinedAt: m.joined_at,
      confirmed: Boolean(authUser.user?.email_confirmed_at),
      lastSignIn: authUser.user?.last_sign_in_at ?? null,
    });
  }
  return rows;
}

export default async function MembersPage(props: PageProps<"/admin/members">) {
  const ctx = await requireAdmin("/admin/members");
  const search = await props.searchParams;

  const manageable = ctx.isPlatformAdmin
    ? await allLabOptions()
    : ctx.adminLabs.map((l) => ({ id: l.labId, name: l.labName }));

  if (manageable.length === 0) {
    return (
      <EmptyState title="管理できる研究室がありません">
        先に研究室を作成するか、既存のオーナーに管理者権限を付与してもらってください。
      </EmptyState>
    );
  }

  const requested = typeof search.lab === "string" ? search.lab : null;
  const labId = manageable.find((l) => l.id === requested)?.id ?? manageable[0].id;
  const lab = manageable.find((l) => l.id === labId)!;

  const members = await loadMembers(labId);
  const myRole = ctx.memberships.find((m) => m.labId === labId)?.role;
  const isOwner = myRole === "owner" || ctx.isPlatformAdmin;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="メンバー" description="研究室のメンバーと権限を管理します。" />
      {manageable.length > 1 && (
        <LabPicker labs={manageable} current={labId} basePath="/admin/members" />
      )}

      <Card
        title={`メンバー — ${lab.name}`}
        subtitle={`${members.length} 名`}
      >
        {members.length === 0 ? (
          <EmptyState title="まだメンバーがいません" />
        ) : (
          <div className="scroll-x rounded-lg border border-line">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-surface-2">
                <tr>
                  {["名前", "メール", "役割", "状態", "最終サインイン", "操作"].map((h) => (
                    <th key={h} className="whitespace-nowrap border-b border-line px-2.5 py-2 text-left font-semibold text-ink-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.userId} className="even:bg-surface-2/40 align-top">
                    <td className="border-b border-line px-2.5 py-2 text-ink">
                      {m.displayName}
                      {m.userId === ctx.user.id && (
                        <span className="ml-1.5 text-[10px] text-ink-3">（あなた）</span>
                      )}
                    </td>
                    <td className="border-b border-line px-2.5 py-2 font-mono text-ink-2">{m.email}</td>
                    <td className="border-b border-line px-2.5 py-2">
                      <Badge tone={m.role === "owner" ? "accent" : m.role === "admin" ? "good" : "neutral"}>
                        {LAB_ROLE_LABELS[m.role].ja}
                      </Badge>
                    </td>
                    <td className="border-b border-line px-2.5 py-2">
                      {m.confirmed ? (
                        <span className="text-good">✓ 確認済み</span>
                      ) : (
                        <span className="text-warn">! 未確認</span>
                      )}
                    </td>
                    <td className="border-b border-line px-2.5 py-2 text-ink-3">
                      {m.lastSignIn ? new Date(m.lastSignIn).toLocaleDateString("ja-JP") : "なし"}
                    </td>
                    <td className="border-b border-line px-2.5 py-2">
                      {m.role === "owner" ? (
                        <span className="text-ink-3">オーナー — 下で譲渡</span>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          <InlineActionForm
                            action={changeMemberRoleAction}
                            hidden={{ lab_id: labId, user_id: m.userId }}
                            submitLabel="変更"
                            icon="save"
                          >
                            <select
                              name="role"
                              defaultValue={m.role}
                              aria-label={`${m.email} の役割`}
                              className="rounded-lg border border-line-strong bg-surface-1 px-2 py-1 text-xs text-ink"
                            >
                              {(["admin", "member", "viewer"] as LabRole[]).map((r) => (
                                <option key={r} value={r}>
                                  {LAB_ROLE_LABELS[r].ja}
                                </option>
                              ))}
                            </select>
                          </InlineActionForm>
                          <InlineActionForm
                            action={removeMemberAction}
                            hidden={{ lab_id: labId, user_id: m.userId }}
                            submitLabel="削除"
                            variant="danger"
                            confirm={`${m.email} を ${lab.name} から削除しますか？データは研究室に残ります。`}
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="メンバーを追加"
        subtitle="アカウントがない場合は招待メールを送ります。"
      >
        <ActionForm action={addMemberAction} hidden={{ lab_id: labId }} submitLabel="追加" icon="plus">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="メールアドレス" htmlFor="member-email">
              <TextInput id="member-email" name="email" type="email" required />
            </Field>
            <Field label="権限" hint="実験・データセット・ノートブックの作成・編集。">
              <Select name="role" defaultValue="member">
                {(["admin", "member", "viewer"] as LabRole[]).map((r) => (
                  <option key={r} value={r}>
                    {LAB_ROLE_LABELS[r].ja}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </ActionForm>
      </Card>

      {isOwner && members.length > 1 && (
        <Card
          title="オーナーの譲渡"
          subtitle="譲渡後、あなたは管理者になります。"
        >
          <Callout tone="warn">
            新しいオーナーが譲り返さない限り、取り消すことはできません。
          </Callout>
          <div className="mt-3">
            <ActionForm
              action={transferOwnershipAction}
              hidden={{ lab_id: labId }}
              submitLabel="譲渡"
              variant="danger"
              confirm="この研究室のオーナー権限を譲渡しますか？"
              icon="arrow"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="新しいオーナー">
                  <Select name="user_id" required>
                    {members
                      .filter((m) => m.role !== "owner")
                      .map((m) => (
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
        </Card>
      )}
    </div>
  );
}

async function allLabOptions() {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("laboratories")
    .select("id, name")
    .order("created_at", { ascending: true });
  return (data ?? []).map((l) => ({ id: l.id, name: l.name }));
}
