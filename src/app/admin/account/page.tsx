import { Badge, Card, DataTable, Field, TextInput } from "@/components/ui";
import { PageHeader } from "@/components/shell/PageHeader";
import { requireUser } from "@/lib/auth/guards";
import { ActionForm } from "@/components/admin/ActionForm";
import { updateDisplayNameAction, changePasswordAction } from "@/lib/auth/actions";
import { LAB_ROLE_LABELS } from "@/lib/auth/roles";
import type { LabRole } from "@/lib/supabase/types";
import { SignOutButton } from "@/components/admin/SignOutButton";

export const dynamic = "force-dynamic";

const ROLE_HINTS_JA: Record<LabRole, string> = {
  owner: "研究室の完全な管理権限。削除も可能。削除不可の役割。",
  admin: "メンバーとデータの管理。研究室の削除は不可。",
  member: "実験・データセット・ノートブックの作成・編集。",
  viewer: "研究室内のすべてを閲覧のみ。",
};

export default async function AccountPage() {
  const ctx = await requireUser("/admin/account");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="アカウント" description="表示名、パスワード、所属研究室を確認・変更します。" />
      <Card
        title="アカウント"
        subtitle={ctx.email}
        actions={<SignOutButton />}
      >
        <DataTable
          headers={["項目", "値"]}
          rows={[
            ["メールアドレス", <span key="e" className="font-mono">{ctx.email}</span>],
            ["ユーザー ID", <span key="i" className="font-mono text-ink-3">{ctx.user.id}</span>],
            [
              "メール確認",
              ctx.user.email_confirmed_at
                ? <span key="c" className="text-good">✓ {new Date(ctx.user.email_confirmed_at).toLocaleDateString("ja-JP")}</span>
                : <span key="c" className="text-warn">! 未確認</span>,
            ],
            [
              "作成日",
              new Date(ctx.user.created_at).toLocaleString("ja-JP"),
            ],
            [
              "システム管理者",
              ctx.isPlatformAdmin
                ? <Badge key="p" tone="accent">はい</Badge>
                : <span key="p" className="text-ink-3">いいえ</span>,
            ],
          ]}
        />
      </Card>

      <Card title="表示名">
        <ActionForm action={updateDisplayNameAction} submitLabel="保存">
          <Field label="表示名" htmlFor="dn">
            <TextInput id="dn" name="display_name" defaultValue={ctx.displayName} required maxLength={80} />
          </Field>
        </ActionForm>
      </Card>

      <Card
        title="パスワード変更"
        subtitle="変更後もこのデバイスではサインインしたままです。"
      >
        <ActionForm action={changePasswordAction} submitLabel="変更">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="新しいパスワード" htmlFor="pw" hint="8文字以上。">
              <TextInput id="pw" name="password" type="password" required minLength={8} autoComplete="new-password" />
            </Field>
            <Field label="確認" htmlFor="pw2">
              <TextInput id="pw2" name="confirm" type="password" required minLength={8} autoComplete="new-password" />
            </Field>
          </div>
        </ActionForm>
      </Card>

      <Card title="所属研究室">
        <DataTable
          headers={["研究室", "役割", "参加日", "権限"]}
          rows={ctx.memberships.map((m) => [
            m.labName,
            <Badge key="r" tone={m.role === "owner" ? "accent" : m.role === "admin" ? "good" : "neutral"}>
              {LAB_ROLE_LABELS[m.role].ja}
            </Badge>,
            new Date(m.joinedAt).toLocaleDateString("ja-JP"),
            <span key="h" className="text-ink-3">{ROLE_HINTS_JA[m.role]}</span>,
          ])}
        />
      </Card>
    </div>
  );
}
