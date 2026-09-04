import { Badge, Callout, Card, DataTable, StatTile } from "@/components/ui";
import { PageHeader } from "@/components/shell/PageHeader";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { AdminEmailComposer } from "@/components/admin/AdminEmailComposer";
import { InlineActionForm } from "@/components/admin/ActionForm";
import {
  loadEmailAudience, listSentEmails, loadSendingCapacity, resumeAdminEmailAction,
} from "@/lib/email/adminActions";
import { isEmailConfigured } from "@/lib/email/smtp";
import { DEFAULT_MAX_MESSAGES_PER_HOUR } from "@/lib/email/limits";

export const dynamic = "force-dynamic";

/**
 * Send mail to one user, several, or everyone, from the deployment's own
 * mailbox.
 *
 * Platform-admin only, the same authority level as /admin/users: this reaches
 * every account's inbox under the deployment's name, which is not something a
 * laboratory does for itself.
 *
 * The composer, the mailbox's remaining capacity and the history sit on one
 * page on purpose. The provider caps outgoing mail per hour, so "how much can
 * I send right now" and "what is still queued from last time" are part of
 * composing, not a separate report to go looking for.
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
  let capacity;
  try {
    // Independent reads - the audience list pages through auth.users, so
    // waiting for it before touching the history would double the page's
    // slowest path for no reason.
    [audience, history, capacity] = await Promise.all([
      loadEmailAudience(),
      listSentEmails(20),
      loadSendingCapacity(),
    ]);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "不明なエラーです。";
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="メール送信" description="ユーザーへメールを送信します。" />
        <Callout tone="danger" title="読み込みに失敗しました">
          {detail}
          {(detail.includes("admin_email") || detail.includes("rate_log")) && (
            <>
              {" "}
              <code className="font-mono text-[12px]">supabase/migrations/all.sql</code>{" "}
              の「Administrator email broadcasts」および「Administrator email:
              rate-limit governor and resumable delivery」の節を Supabase の SQL
              エディタで実行してください。
            </>
          )}
        </Callout>
      </div>
    );
  }

  const totalPending = history.reduce((sum, h) => sum + h.pendingCount, 0);
  const totalFailed = history.reduce((sum, h) => sum + h.failedCount, 0);
  const onTrialLimit = capacity.messagesPerHour <= DEFAULT_MAX_MESSAGES_PER_HOUR;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="メール送信"
        description="登録ユーザーへ個別または一斉にメールを送信します。システム管理者のみ。"
        meta={
          <>
            {audience.sender && <Badge tone="accent">差出人: {audience.sender}</Badge>}
            <Badge tone={capacity.messagesRemaining > 0 ? "good" : "warn"}>
              今すぐ送信可能: 約 {capacity.reachableNow.toLocaleString("ja-JP")} 件
            </Badge>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="1時間の送信上限"
          value={`${capacity.messagesPerHour} 通`}
          hint={`${capacity.recipientsPerHour.toLocaleString("ja-JP")} 宛先まで／1通に最大 ${capacity.recipientsPerMessage} 宛先`}
          tone="accent"
        />
        <StatTile
          label="今すぐ届けられる宛先"
          value={capacity.reachableNow.toLocaleString("ja-JP")}
          hint={`残り ${capacity.messagesRemaining} 通 / ${capacity.messagesPerHour} 通`}
          tone={capacity.messagesRemaining > 0 ? "good" : "warn"}
        />
        <StatTile
          label="待機中の宛先"
          value={totalPending.toLocaleString("ja-JP")}
          hint={totalPending > 0 ? "「残りを送信」で続行できます" : "なし"}
          tone={totalPending > 0 ? "warn" : "good"}
        />
        <StatTile
          label="失敗（直近20回）"
          value={totalFailed}
          tone={totalFailed ? "warn" : "good"}
        />
      </div>

      {/* An optional upgrade, not a blocker: without these tables the send
          still batches and still stops on the first throttle, it just cannot
          resume a campaign across hours or remember the budget across a
          restart. Worded as a recommendation so nobody goes looking for a
          fault that is not there. */}
      {!capacity.ledgerReady && (
        <Callout tone="warn" title="データベースを更新すると、より確実に送信できます">
          <code className="font-mono text-[12px]">supabase/migrations/all.sql</code>{" "}
          の末尾にある「Administrator email: rate-limit governor and resumable
          delivery」の節が、まだこのデータベースに適用されていません。
          <br />
          <strong>送信は現在も可能です。</strong>
          BCC一括送信・1時間あたりの上限・エラー検知時の即時停止はすべて有効です。
          ただし次の2点が制限されます:
          <ul className="mt-1 ml-4 list-disc">
            <li>
              上限を超えた宛先を「待機列」に保存できないため、超過分は送信されず、
              後から宛先を選び直して再送する必要があります（自動再開は使えません）。
            </li>
            <li>
              送信数の記録がサーバー再起動で失われるため、上限管理が概算になります。
            </li>
          </ul>
          上記の節を Supabase の SQL エディタで実行すると、どちらも解消されます。
        </Callout>
      )}

      {capacity.messagesRemaining === 0 && (
        <Callout tone="warn" title="現在、送信上限に達しています">
          直近1時間で {capacity.messagesUsed} 通を送信済みです。
          {capacity.resetsAt && (
            <>
              {" "}
              {new Date(capacity.resetsAt).toLocaleTimeString("ja-JP")}{" "}
              以降に順次送信できるようになります。
            </>
          )}{" "}
          この状態で送信を実行しても、宛先は待機列に入るだけで実際には送信されません。
        </Callout>
      )}

      {onTrialLimit ? (
        <Callout tone="info" title="送信上限を引き上げられます">
          現在は1時間あたり {capacity.messagesPerHour} 通で動作しています。これは Namecheap
          Private Email の<strong>トライアルプランの上限</strong>と同じ値です。
          有料プランでは1時間あたり 500 通まで許可されるため、環境変数{" "}
          <code className="font-mono text-[12px]">SMTP_MAX_MESSAGES_PER_HOUR=500</code>{" "}
          を設定してください（設定後はサーバーの再起動が必要です）。
          プランを確認せずに引き上げると、超過分が「too many messages」で失敗します。
        </Callout>
      ) : (
        <Callout tone="info" title="1時間あたりの上限は2つあります">
          <strong>{capacity.messagesPerHour} 通</strong>（送信するメール本体の数）と{" "}
          <strong>{capacity.recipientsPerHour.toLocaleString("ja-JP")} 宛先</strong>
          （届く人数）の両方が上限で、先に到達したほうで停止します。
          BCC一括送信では1通に最大 {capacity.recipientsPerMessage} 宛先まとめられるため、
          {capacity.recipientsPerHour.toLocaleString("ja-JP")} 宛先は{" "}
          {Math.ceil(capacity.recipientsPerHour / capacity.recipientsPerMessage)} 通に収まります。
          <br />
          宛先数の上限は、Namecheap の「1時間 {capacity.messagesPerHour} 通」が
          BCCの宛先を1通と数えるか人数分と数えるか公表されていないため、
          <strong>どちらの解釈でも安全な値</strong>を既定にしています。
          さらに増やす場合は Namecheap に確認のうえ{" "}
          <code className="font-mono text-[12px]">SMTP_MAX_RECIPIENTS_PER_HOUR</code>{" "}
          を設定してください。上限を超えてもエラーにはならず、待機列に入ります。
        </Callout>
      )}

      <AdminEmailComposer
        users={audience.users}
        labs={audience.labs}
        sender={audience.sender}
        capacity={capacity}
      />

      <Card
        title="送信履歴"
        subtitle="直近20回の送信です。失敗した宛先と、送信上限で待機中の宛先はここで確認できます。"
      >
        <DataTable
          headers={["日時", "件名", "宛先", "成功", "待機", "失敗", "通数", "送信者", ""]}
          align={["left", "left", "right", "right", "right", "right", "right", "left", "left"]}
          rows={history.map((h) => [
            new Date(h.createdAt).toLocaleString("ja-JP"),
            <span key="subject" className="flex flex-col gap-0.5">
              <span className="truncate">{h.subject}</span>
              <span className="text-[12px] text-ink-3">
                {AUDIENCE_LABELS[h.audience] ?? h.audience}
                {h.deliveryMode === "bcc" ? "・BCC一括" : "・個別送信"}
              </span>
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
            h.pendingCount > 0
              ? <span key="pending" className="text-warn">{h.pendingCount}</span>
              : <span key="pending" className="text-ink-3">0</span>,
            h.failedCount > 0
              ? <span key="failed" className="text-danger">{h.failedCount}</span>
              : <span key="failed" className="text-ink-3">0</span>,
            h.messageCount,
            h.sentByEmail ?? "—",
            h.pendingCount > 0
              ? (
                <InlineActionForm
                  key="resume"
                  action={resumeAdminEmailAction}
                  hidden={{ message_id: h.id }}
                  submitLabel="残りを送信"
                  icon="send"
                  confirm={`待機中の ${h.pendingCount} 件の送信を再開しますか？送信上限に達している場合は、送れる分だけ送信されます。`}
                />
              )
              : <span key="resume" className="text-ink-3">—</span>,
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
