import Link from "next/link";
import { Badge, Card, DataTable, Field, StatTile } from "@/components/ui";
import { PasswordInput } from "@/components/PasswordInput";
import { PageHeader } from "@/components/shell/PageHeader";
import { requireUser } from "@/lib/auth/guards";
import { ActionForm } from "@/components/admin/ActionForm";
import { changePasswordAction } from "@/lib/auth/actions";
import { phoneNationalPart } from "@/lib/auth/profileFields";
import { LAB_ROLE_LABELS, PLATFORM_ROLE_LABELS } from "@/lib/auth/roles";
import type { LabRole } from "@/lib/supabase/types";
import { SignOutButton } from "@/components/admin/SignOutButton";
import { getMyPeerReviewCredits } from "@/lib/peerReview/credits";
import { createServerSupabase } from "@/lib/supabase/server";
import { AccountProfileForm } from "@/components/account/AccountProfileForm";

export const dynamic = "force-dynamic";

const ROLE_HINTS_JA: Record<LabRole, string> = {
  owner: "研究室の完全な管理権限。削除も可能。削除不可の役割。",
  admin: "メンバーとデータの管理。研究室の削除は不可。",
  member: "実験・データセット・ノートブックの作成・編集。",
  viewer: "研究室内のすべてを閲覧のみ。",
};

export default async function AccountPage() {
  const ctx = await requireUser("/account");
  const supabase = await createServerSupabase();
  const [credits, profileRow] = await Promise.all([
    getMyPeerReviewCredits(),
    supabase
      .from("profiles")
      .select("display_name, avatar_url, date_of_birth, phone_number, major")
      .eq("id", ctx.user.id)
      .maybeSingle(),
  ]);

  const profile = profileRow.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="アカウント" />
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
              "権限",
              <span key="p" className="flex flex-wrap items-center gap-2">
                <Badge tone={ctx.isPlatformAdmin ? "accent" : "neutral"}>
                  {PLATFORM_ROLE_LABELS[ctx.platformRole].ja}
                </Badge>
                <span className="text-xs text-ink-3">
                  {PLATFORM_ROLE_LABELS[ctx.platformRole].hint}
                </span>
              </span>,
            ],
          ]}
        />
      </Card>

      {credits.totalPurchased > 0 && (
        <Card
          title="AI査読の利用回数"
          subtitle="購入した回数の残り・これまでの利用をまとめて表示します。"
          actions={
            <Link href="/peer-review" className="text-xs text-accent underline">
              回数を追加
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              label="残り回数"
              value={`${credits.remaining} 回`}
              tone={credits.remaining > 0 ? "accent" : "danger"}
              hint={`無料 ${credits.freeRemaining} ＋ 購入分 ${credits.purchasedBalance}`}
            />
            <StatTile label="購入した回数" value={`${credits.totalPurchased} 回`} />
            <StatTile label="これまでの利用" value={`${credits.usedCount} 回`} />
          </div>
        </Card>
      )}

      <Card
        title="個人情報"
        subtitle="表示名・アバター・連絡先など、登録時と同じ項目を変更できます。"
      >
        <AccountProfileForm
          displayName={profile?.display_name ?? ctx.displayName}
          dateOfBirth={profile?.date_of_birth ?? null}
          phoneNational={phoneNationalPart(profile?.phone_number)}
          major={profile?.major ?? null}
          avatarUrl={profile?.avatar_url ?? ctx.avatarUrl}
        />
      </Card>

      <Card title="パスワード変更">
        <ActionForm action={changePasswordAction} submitLabel="変更" icon="lock">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="新しいパスワード" htmlFor="pw" hint="8文字以上。">
              <PasswordInput id="pw" name="password" required minLength={8} autoComplete="new-password" />
            </Field>
            <Field label="確認" htmlFor="pw2">
              <PasswordInput id="pw2" name="confirm" required minLength={8} autoComplete="new-password" />
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
