import Link from "next/link";
import { Badge, Callout, Card, EmptyState, StatTile } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { requireUser } from "@/lib/auth/guards";
import { listRecentPeerReviews } from "@/lib/peerReview/actions";
import { getMyPeerReviewCredits } from "@/lib/peerReview/credits";
import {
  listMyNotebookEntriesGrouped,
  listMyNotebookEntriesToday,
} from "@/lib/notebook/actions";
import { FREE_PEER_REVIEW_CREDITS } from "@/lib/peerReview/creditPacks";
import { getLabEntitlement } from "@/lib/billing/subscription";
import { STATUS_LABELS } from "@/lib/billing/plans";
import { scoreTone } from "@/lib/ai/peerReviewReport";
import { DashboardLabReports } from "@/components/dashboard/DashboardLabReports";

export const dynamic = "force-dynamic";

interface Tile {
  href: string;
  title: string;
  description: string;
  icon: IconName;
}

/**
 * Administration. Shown only to platform admins on the user dashboard.
 */
const ADMIN_TILES: Tile[] = [
  { href: "/admin", title: "管理ダッシュボード", description: "全体の統計と最近の操作。", icon: "chart" },
  { href: "/admin/users", title: "ユーザー管理", description: "アカウントの作成・権限変更・削除。", icon: "user" },
  { href: "/admin/labs", title: "研究室管理", description: "研究室の作成・設定・削除。", icon: "folder" },
  { href: "/admin/members", title: "メンバー管理", description: "研究室ごとの所属と役割。", icon: "user" },
  { href: "/admin/experiments", title: "実験管理", description: "全研究室の実験を作成・編集・削除。", icon: "beaker" },
  { href: "/admin/templates", title: "テンプレート管理", description: "全テンプレートの確認・編集・削除。", icon: "notebook" },
  { href: "/admin/audit", title: "監査ログ", description: "追記のみの操作履歴。", icon: "file" },
];

function TileGrid({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((item) => (
        <Link key={item.href} href={item.href} className="group">
          <Card className="card-hover h-full">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
                <Icon name={item.icon} className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[16px] font-medium text-ink group-hover:text-accent">
                  {item.title}
                </span>
                <span className="mt-0.5 block text-xs text-ink-3">{item.description}</span>
              </span>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

export default async function DashboardPage(props: PageProps<"/dashboard">) {
  // Signed-in only: the public entry point is the landing page at `/`, so a
  // visitor who reaches here without a session is sent to log in and returned
  // to this page afterwards rather than shown an empty dashboard.
  const [ctx, search] = await Promise.all([requireUser("/dashboard"), props.searchParams]);
  const denied = typeof search.denied === "string" ? search.denied : null;
  const isAdmin = ctx.isPlatformAdmin;

  const primaryLab = ctx.memberships[0] ?? null;
  const [recentReviews, credits, entitlement, todaysReports, reportGroups] = await Promise.all([
    listRecentPeerReviews(10).then((r) => r.data ?? []),
    getMyPeerReviewCredits(),
    primaryLab ? getLabEntitlement(primaryLab.labId) : Promise.resolve(null),
    listMyNotebookEntriesToday().then((r) => r.data ?? []),
    listMyNotebookEntriesGrouped().then((r) => r.data ?? []),
  ]);

  const planName = entitlement?.plan.name ?? "無料";
  const planStatus = entitlement?.status
    ? STATUS_LABELS[entitlement.status]
    : { ja: "未契約", tone: "neutral" as const };

  return (
    <div className="flex flex-col gap-8">
      {denied === "admin" && (
        <Callout tone="warn" title="管理者専用">
          そのページは管理者のみが利用できます。権限が必要な場合は管理者に依頼してください。
        </Callout>
      )}

      <DashboardLabReports today={todaysReports} groups={reportGroups} />

      {credits && (
        <Card
          title="利用状況"
          subtitle="研究室プランと、AI査読の回数残高をまとめて表示します。"
          actions={
            <div className="flex flex-wrap gap-3">
              <Link href="/billing" className="text-xs text-accent underline">
                料金・支払い
              </Link>
              <Link href="/peer-review" className="text-xs text-accent underline">
                回数を追加
              </Link>
            </div>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="border border-line px-4 py-3">
              <p className="text-[11px] text-ink-3">現在のプラン</p>
              <p className="mt-1 font-serif text-xl font-semibold text-ink">
                {planName}
                <span className="text-[13px] font-normal text-ink-3">プラン</span>
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone={planStatus.tone}>{planStatus.ja}</Badge>
                {primaryLab && (
                  <span className="truncate text-[11px] text-ink-3">{primaryLab.labName}</span>
                )}
              </div>
            </div>

            <StatTile
              label="購入した回数"
              value={`${credits.totalPurchased} 回`}
              hint="これまでに買い足したAI査読の合計"
            />
            <StatTile
              label="残り回数"
              value={`${credits.remaining} 回`}
              tone={credits.remaining > 0 ? "accent" : "danger"}
              hint={`無料 ${credits.freeRemaining} ＋ 購入分 ${credits.purchasedBalance}`}
            />
            <StatTile
              label="これまでの査読"
              value={`${credits.usedCount} 回`}
              hint={`最初の${FREE_PEER_REVIEW_CREDITS}回は無料`}
            />
          </div>
        </Card>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink-2">最近のAI査読</h2>
          <Link href="/peer-review" className="text-xs text-accent underline">
            AI査読を開く
          </Link>
        </div>
        <Card>
          {recentReviews.length === 0 ? (
            <EmptyState title="まだAI査読の記録がありません">
              <Link href="/peer-review" className="text-accent underline">AI査読</Link>
              で論文をアップロードすると、ここに結果が表示されます。
            </EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--border)] text-[13px]">
              {recentReviews.map((r) => {
                const meta = [
                  r.experiment_name,
                  r.lab_name,
                  new Date(r.created_at).toLocaleDateString("ja-JP"),
                ].filter(Boolean).join(" ・ ");
                return (
                  <li key={r.id} className="flex items-center gap-3 py-1.5 first:pt-0 last:pb-0">
                    <span className="min-w-0 flex-1 truncate font-medium text-ink">
                      {r.title}
                      {r.previous_review_id && <>{" "}<Badge tone="neutral">再査読</Badge></>}
                    </span>
                    <span className="hidden shrink-0 truncate text-[11px] text-ink-3 sm:block sm:max-w-[240px]">
                      {meta}
                    </span>
                    <Badge tone={scoreTone(r.overall_score)}>{r.overall_score} / 100</Badge>
                    <Link
                      href={`/peer-review/${r.id}`}
                      className="shrink-0 text-[11px] text-accent underline underline-offset-2"
                    >
                      詳細
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>

      {isAdmin && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-ink-2">管理</h2>
          <TileGrid tiles={ADMIN_TILES} />
        </section>
      )}
    </div>
  );
}
