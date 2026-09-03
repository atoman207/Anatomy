import { Badge, Callout, Card, DataTable, StatTile } from "@/components/ui";
import { PageHeader } from "@/components/shell/PageHeader";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { AdminEmailComposer } from "@/components/admin/AdminEmailComposer";
import { loadEmailAudience, listSentEmails } from "@/lib/email/adminActions";
import { isEmailConfigured } from "@/lib/email/smtp";

export const dynamic = "force-dynamic";

/**
 * Send mail to one user, several, or everyone, from the deployment's own
 * mailbox.
 *
 * Platform-admin only, the same authority level as /admin/users: this reaches
 * every account's inbox under the deployment's name, which is not something a
 * laboratory does for itself.
 *
 * The composer and the history sit on one page on purpose. A broadcast is
 * sent one message per recipient and any single address can be refused, so
 * "what happened to the last send" is part of sending, not a separate report
 * to go looking for.
 */
export default async function AdminEmailPage() {
  await requirePlatformAdmin("/admin/email");

  if (!isEmailConfigured()) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="メール送信"
          description="ユーザーへメールを送信します。システム管理者のみ。"
        />
        <Callout tone="warn" title="SMTPが設定されていません">
          <code className="font-mono text-[12px]">SMTP_HOST</code>／
          <code className="font-mono text-[12px]">SMTP_USER</code>／
          <code className="font-mono text-[12px]">SMTP_PASSWORD</code>{" "}
          を環境変数に設定してください（<code className="font-mono text-[12px]">.env.example</code>{" "}
          の SMTP の節を参照）。差出人アドレスは{" "}
          <code className="font-mono text-[12px]">SMTP_FROM</code>{" "}
          で指定します。
        </Callout>
      </div>
    );
  }

  let audience;
  let history;
  try {
    // Independent reads - the audience list pages through auth.users, so
    // waiting for it before touching the history would double the page's
    // slowest path for no reason.
    [audience, history] = await Promise.all([loadEmailAudience(), listSentEmails(20)]);
  } catch (e) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="メール送信" description="ユーザーへメールを送信します。" />
        <Callout tone="danger" title="読み込みに失敗しました">
          {e instanceof Error ? e.message : "不明なエラーです。"}
          {e instanceof Error && e.message.includes("admin_email") && (
            <>
              {" "}
              <code className="font-mono text-[12px]">supabase/migrations/all.sql</code>{" "}
              の「Administrator email broadcasts」の節を Supabase の SQL エディタで
              実行してください。
            </>
          )}
        </Callout>
      </div>
    );
  }

  const totalSent = history.reduce((sum, h) => sum + h.sentCount, 0);
  const totalFailed = history.reduce((sum, h) => sum + h.failedCount, 0);
  const unconfirmed = audience.users.filter((u) => !u.confirmed).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="メール送信"
        description="登録ユーザーへ個別または一斉にメールを送信します。システム管理者のみ。"
        meta={
          audience.sender && (
            <Badge tone="accent">差出人: {audience.sender}</Badge>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="送信可能なユーザー" value={audience.users.length} tone="accent" />
        <StatTile label="未確認アドレス" value={unconfirmed} tone={unconfirmed ? "warn" : "good"} />
        <StatTile label="送信済み（直近20回）" value={totalSent} />
        <StatTile label="失敗（直近20回）" value={totalFailed} tone={totalFailed ? "warn" : "good"} />
      </div>

      <AdminEmailComposer
        users={audience.users}
        labs={audience.labs}
        sender={audience.sender}
      />

      <Card title="送信履歴" subtitle="直近20回の送信です。失敗した宛先はここで確認できます。">
        <DataTable
          headers={["日時", "件名", "宛先", "成功", "失敗", "送信者"]}
          align={["left", "left", "right", "right", "right", "left"]}
          rows={history.map((h) => [
            new Date(h.createdAt).toLocaleString("ja-JP"),
            <span key="subject" className="flex flex-col gap-0.5">
              <span className="truncate">{h.subject}</span>
              <span className="text-[12px] text-ink-3">{AUDIENCE_LABELS[h.audience] ?? h.audience}</span>
              {h.failures.length > 0 && (
                <span className="text-[12px] text-danger">
                  失敗: {h.failures.slice(0, 3).map((f) => f.email).join("、")}
                  {h.failures.length > 3 && ` ほか${h.failures.length - 3}件`}
                  {h.failures[0].error && `（${h.failures[0].error}）`}
                </span>
              )}
            </span>,
            h.recipientCount,
            <span key="sent" className="text-good">{h.sentCount}</span>,
            h.failedCount > 0
              ? <span key="failed" className="text-danger">{h.failedCount}</span>
              : <span key="failed" className="text-ink-3">0</span>,
            h.sentByEmail ?? "—",
          ])}
        />
      </Card>
    </div>
  );
}

const AUDIENCE_LABELS: Record<string, string> = {
  all: "全ユーザー",
  selected: "選択したユーザー",
  manual: "手入力アドレス",
};
