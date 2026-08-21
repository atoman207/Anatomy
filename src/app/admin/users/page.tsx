import { Badge, Callout, Card, Field, StatTile, TextInput } from "@/components/ui";
import { PageHeader } from "@/components/shell/PageHeader";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { createAdminSupabase } from "@/lib/supabase/server";
import { LAB_ROLE_LABELS, PLATFORM_ROLE_LABELS } from "@/lib/auth/roles";
import type { LabRole, PlatformRole } from "@/lib/supabase/types";
import { ActionForm, InlineActionForm } from "@/components/admin/ActionForm";
import {
  createUserAction, confirmUserAction, deleteUserAction, sendPasswordResetAction,
  setPlatformRoleAction,
} from "../actions";

export const dynamic = "force-dynamic";

interface UserView {
  id: string;
  email: string;
  displayName: string;
  confirmed: boolean;
  createdAt: string;
  lastSignIn: string | null;
  labs: { name: string; role: string }[];
  platformRole: PlatformRole;
}

/**
 * Every account on the deployment.
 *
 * Platform administrators only - the layout guard and `requirePlatformAdmin`
 * both enforce it, and each action re-checks before touching anything.
 */
export default async function UsersPage() {
  const ctx = await requirePlatformAdmin("/admin/users");
  const admin = createAdminSupabase();

  const users: UserView[] = [];
  let page = 1;
  while (page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      return (
        <Callout tone="danger" title="ユーザーを取得できません">{error.message}</Callout>
      );
    }
    for (const u of data.users) {
      users.push({
        id: u.id,
        email: u.email ?? "（メールなし）",
        displayName:
          (u.user_metadata?.display_name as string | undefined) ??
          (u.email ?? "").split("@")[0],
        confirmed: Boolean(u.email_confirmed_at),
        createdAt: u.created_at,
        lastSignIn: u.last_sign_in_at ?? null,
        labs: [],
        platformRole: "user",
      });
    }
    if (data.users.length < 200) break;
    page++;
  }

  // Attach laboratory memberships.
  const { data: memberships } = await admin
    .from("lab_members")
    .select("user_id, role, laboratories(name)");
  const byUser = new Map<string, { name: string; role: string }[]>();
  for (const m of memberships ?? []) {
    const embedded = m.laboratories as unknown;
    const lab = (Array.isArray(embedded) ? embedded[0] : embedded) as { name: string } | null;
    if (!lab) continue;
    byUser.set(m.user_id, [...(byUser.get(m.user_id) ?? []), { name: lab.name, role: m.role }]);
  }
  // Platform roles come from `profiles`, which is the authority. Reading them
  // here rather than inferring from the signed-in administrator's own address
  // is what lets this table show who *else* is an administrator.
  const { data: profiles } = await admin.from("profiles").select("id, platform_role");
  const roleById = new Map(
    (profiles ?? []).map((p) => [p.id, (p.platform_role ?? "user") as PlatformRole]),
  );
  for (const u of users) {
    u.labs = byUser.get(u.id) ?? [];
    u.platformRole = roleById.get(u.id) ?? "user";
  }

  const unconfirmed = users.filter((u) => !u.confirmed).length;
  const neverSignedIn = users.filter((u) => !u.lastSignIn).length;
  const administrators = users.filter((u) => u.platformRole === "admin").length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="ユーザー" description="この環境のすべてのアカウントを管理します。システム管理者のみ。" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile label="ユーザー" value={users.length} tone="accent" />
        <StatTile label="管理者" value={administrators} tone="good" />
        <StatTile label="未確認" value={unconfirmed} tone={unconfirmed ? "warn" : "good"} />
        <StatTile label="未サインイン" value={neverSignedIn} />
        <StatTile label="研究室所属" value={users.filter((u) => u.labs.length > 0).length} />
      </div>

      <Card title="ユーザー" subtitle={`この環境に ${users.length} 件のアカウントがあります`}>
        <div className="scroll-x rounded-lg border border-line">
          <table className="w-full border-collapse text-xs">
            <thead className="bg-surface-2">
              <tr>
                {["メール", "名前", "権限", "状態", "研究室", "最終サインイン", "操作"].map((h) => (
                  <th key={h} className="whitespace-nowrap border-b border-line px-2.5 py-2 text-left font-semibold text-ink-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="even:bg-surface-2/40 align-top">
                  <td className="border-b border-line px-2.5 py-2 font-mono text-ink">
                    {u.email}
                  </td>
                  <td className="border-b border-line px-2.5 py-2 text-ink-2">{u.displayName}</td>
                  <td className="border-b border-line px-2.5 py-2">
                    <Badge tone={u.platformRole === "admin" ? "accent" : "neutral"}>
                      {PLATFORM_ROLE_LABELS[u.platformRole].ja}
                    </Badge>
                  </td>
                  <td className="border-b border-line px-2.5 py-2">
                    {u.confirmed ? (
                      <span className="text-good">✓ 確認済み</span>
                    ) : (
                      <span className="text-warn">! 未確認</span>
                    )}
                  </td>
                  <td className="border-b border-line px-2.5 py-2 text-ink-2">
                    {u.labs.length === 0
                      ? <span className="text-ink-3">なし</span>
                      : u.labs.map((l) => {
                          const roleJa = LAB_ROLE_LABELS[l.role as LabRole]?.ja ?? l.role;
                          return `${l.name}（${roleJa}）`;
                        }).join("、")}
                  </td>
                  <td className="border-b border-line px-2.5 py-2 text-ink-3">
                    {u.lastSignIn ? new Date(u.lastSignIn).toLocaleString("ja-JP") : "なし"}
                  </td>
                  <td className="border-b border-line px-2.5 py-2">
                    <div className="flex flex-col gap-1.5">
                      {/* Demoting yourself is refused by the action too; hiding
                          it here keeps the last administrator from reaching for
                          a button that cannot work. */}
                      {u.id !== ctx.user.id && (
                        <InlineActionForm
                          action={setPlatformRoleAction}
                          hidden={{
                            user_id: u.id,
                            platform_role: u.platformRole === "admin" ? "user" : "admin",
                          }}
                          submitLabel={u.platformRole === "admin" ? "ユーザーに降格" : "管理者に昇格"}
                          icon={u.platformRole === "admin" ? "user" : "lock"}
                          confirm={
                            u.platformRole === "admin"
                              ? `${u.email} の管理者権限を解除しますか？`
                              : `${u.email} に全ユーザー・全研究室の管理権限を与えますか？`
                          }
                        />
                      )}
                      {!u.confirmed && (
                        <InlineActionForm
                          action={confirmUserAction}
                          hidden={{ user_id: u.id }}
                          submitLabel="確認済にする"
                          icon="check"
                        />
                      )}
                      <InlineActionForm
                        action={sendPasswordResetAction}
                        hidden={{ email: u.email }}
                        submitLabel="再設定メール"
                        icon="mail"
                      />
                      {u.id !== ctx.user.id && (
                        <InlineActionForm
                          action={deleteUserAction}
                          hidden={{ user_id: u.id }}
                          submitLabel="削除"
                          variant="danger"
                          confirm={`${u.email} を永久に削除しますか？`}
                        >
                          <input
                            name="confirm"
                            placeholder="メールアドレスを入力"
                            aria-label={`${u.email} の削除確認`}
                            className="w-36 rounded-lg border border-line-strong bg-surface-1 px-2 py-1 text-[11px] text-ink"
                          />
                        </InlineActionForm>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="ユーザーを作成"
        subtitle="確認済みのアカウントとして作成します。"
      >
        <Callout tone="info">
          このプロジェクトではメール確認が必要ですが、新しい Supabase プロジェクトの
          組み込みメーラーは1時間に数通に制限されています。ここでアカウントを作成すれば
          その制限を回避できます。
        </Callout>
        <div className="mt-3">
          <ActionForm action={createUserAction} submitLabel="作成" icon="plus">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="メール" htmlFor="new-email">
                <TextInput id="new-email" name="email" type="email" required />
              </Field>
              <Field label="表示名" htmlFor="new-name">
                <TextInput id="new-name" name="display_name" placeholder="任意" />
              </Field>
              <Field label="パスワード" htmlFor="new-pass" hint="8文字以上。">
                <TextInput id="new-pass" name="password" type="password" required minLength={8} />
              </Field>
            </div>
          </ActionForm>
        </div>
      </Card>

      <Card title="権限について" subtitle="この環境の権限は「管理者」と「ユーザー」の2種類です。">
        <ul className="flex flex-col divide-y divide-[var(--border)]">
          {(["admin", "user"] as PlatformRole[]).map((role) => (
            <li key={role} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">
                  {PLATFORM_ROLE_LABELS[role].ja}
                </p>
                <p className="text-xs text-ink-3">{PLATFORM_ROLE_LABELS[role].hint}</p>
              </div>
              <Badge tone={role === "admin" ? "accent" : "neutral"}>
                {users.filter((u) => u.platformRole === role).length} 名
              </Badge>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <Callout tone="info">
            権限はデータベース（profiles.platform_role）に保存され、上の表から変更できます。
            ユーザー自身が自分の権限を書き換えることはできません。
          </Callout>
        </div>
      </Card>
    </div>
  );
}
