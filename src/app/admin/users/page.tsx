import { Badge, Callout, Card, Field, StatTile, TextInput } from "@/components/ui";
import { PageHeader } from "@/components/shell/PageHeader";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { createAdminSupabase } from "@/lib/supabase/server";
import { LAB_ROLE_LABELS } from "@/lib/auth/roles";
import type { LabRole } from "@/lib/supabase/types";
import { ActionForm, InlineActionForm } from "@/components/admin/ActionForm";
import {
  createUserAction, confirmUserAction, deleteUserAction, sendPasswordResetAction,
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
  isPlatformAdmin: boolean;
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
        isPlatformAdmin: false,
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
  for (const u of users) {
    u.labs = byUser.get(u.id) ?? [];
    u.isPlatformAdmin = u.email.toLowerCase() === ctx.email.toLowerCase();
  }

  const unconfirmed = users.filter((u) => !u.confirmed).length;
  const neverSignedIn = users.filter((u) => !u.lastSignIn).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="ユーザー" description="この環境のすべてのアカウントを管理します。システム管理者のみ。" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="ユーザー" value={users.length} tone="accent" />
        <StatTile label="未確認" value={unconfirmed} tone={unconfirmed ? "warn" : "good"} />
        <StatTile label="未サインイン" value={neverSignedIn} />
        <StatTile label="研究室所属" value={users.filter((u) => u.labs.length > 0).length} />
      </div>

      <Card title="ユーザー" subtitle={`この環境に ${users.length} 件のアカウントがあります`}>
        <div className="scroll-x rounded-lg border border-line">
          <table className="w-full border-collapse text-xs">
            <thead className="bg-surface-2">
              <tr>
                {["メール", "名前", "状態", "研究室", "最終サインイン", "操作"].map((h) => (
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
                    {u.isPlatformAdmin && (
                      <Badge tone="accent">
                        <span className="ml-0">システム管理者</span>
                      </Badge>
                    )}
                  </td>
                  <td className="border-b border-line px-2.5 py-2 text-ink-2">{u.displayName}</td>
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

      <Card title="システム管理者">
        <Callout tone="info">
          システム管理者はサーバー設定で指定されます。追加・変更は運用担当者に依頼してください。
        </Callout>
      </Card>
    </div>
  );
}
