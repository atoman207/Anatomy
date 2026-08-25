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

export const dynamic = "force-dynamic";

interface Tile {
  href: string;
  title: string;
  description: string;
  icon: IconName;
}

/**
 * Research tools. This is the whole of the product for a User: recording,
 * organising and analysing their own laboratory's work.
 */
const RESEARCH_TILES: Tile[] = [
  { href: "/labs", title: "研究室", description: "研究室の作成・招待・メンバー管理。", icon: "team" },
  { href: "/notebook", title: "実験ノート", description: "前回から雛形を引き継ぎ、結果を記録。", icon: "notebook" },
  { href: "/voice", title: "音声メモ", description: "音声から実験ノートを起こす。", icon: "mic" },
  { href: "/reagents", title: "試薬・Lot", description: "試薬とロット番号の記録。", icon: "reagents" },
  { href: "/experiments", title: "実験一覧", description: "所属研究室の実験を一覧。", icon: "file" },
  { href: "/organize", title: "データ整理", description: "ファイル名の整理とサンプルシート作成。", icon: "folder" },
  { href: "/analyze", title: "統計・図", description: "検定・多変量解析と作図。", icon: "chart" },
  { href: "/literature", title: "論文検索", description: "PubMed・Crossref を検索して保存。", icon: "search" },
  { href: "/calculator", title: "計算ツール", description: "希釈・モル濃度などの計算。", icon: "calculator" },
];

/**
 * Administration. Deliberately a different list rather than a few extra tiles
 * appended to the one above: an administrator arriving here is running the
 * deployment, and the management entry points should be the first thing they
 * see, not something to scroll past the research tools to find.
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

  const planName = entitlement?.plan.name ?? "フリー";
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

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink-2">今日のラボレポート</h2>
          <Link href="/record?step=4" className="text-xs text-accent underline">
            実験記録を開く
          </Link>
        </div>
        <Card>
          {todaysReports.length === 0 ? (
            <EmptyState title="今日作成されたラボレポートはまだありません">
              <Link href="/record?step=4" className="text-accent underline">実験記録</Link>
              でレポートを作成すると、ここに表示されます。
            </EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--border)] text-[13px]">
              {todaysReports.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-1.5 first:pt-0 last:pb-0">
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{r.title}</span>
                  <span className="hidden shrink-0 truncate text-[11px] text-ink-3 sm:block sm:max-w-[240px]">
                    {r.experiment_name} ・ {r.lab_name}
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-3">
                    {new Date(r.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <Link
                    href={`/record?step=4`}
                    className="shrink-0 text-[11px] text-accent underline underline-offset-2"
                  >
                    開く
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink-2">すべてのラボレポート（実験ごと）</h2>
          <Link href="/experiments" className="text-xs text-accent underline">
            実験一覧を見る
          </Link>
        </div>
        <Card subtitle="あなたが作成したラボレポートを、実験ごとにまとめて確認できます。">
          {reportGroups.length === 0 ? (
            <EmptyState title="まだラボレポートがありません">
              <Link href="/record?step=4" className="text-accent underline">実験記録</Link>
              でレポートを作成すると、実験ごとにここへまとまります。
            </EmptyState>
          ) : (
            <div className="flex flex-col divide-y divide-[var(--border)]">
              {reportGroups.map((g, i) => (
                <details key={g.experimentId} className="py-2 first:pt-0 last:pb-0" open={i === 0}>
                  <summary className="cursor-pointer text-[13px] font-medium text-ink">
                    {g.experimentName}
                    <span className="ml-1.5 font-normal text-ink-3">
                      ・ {g.labName} ・ {g.entries.length} 件
                    </span>
                  </summary>
                  <ul className="mt-2 flex flex-col gap-1.5 pl-3">
                    {g.entries.map((r) => (
                      <li key={r.id} className="flex items-center gap-2 text-[12px]">
                        <span className="min-w-0 flex-1 truncate text-ink-2">{r.title}</span>
                        {r.template_slug && <Badge>{r.template_slug}</Badge>}
                        <span className="shrink-0 text-ink-3">
                          {new Date(r.created_at).toLocaleDateString("ja-JP")}
                        </span>
                        <Link
                          href="/record?step=4"
                          className="shrink-0 text-accent underline underline-offset-2"
                        >
                          開く
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          )}
        </Card>
      </section>

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

      {isAdmin ? (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-ink-2">管理</h2>
            <TileGrid tiles={ADMIN_TILES} />
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-ink-2">研究ツール</h2>
            <TileGrid tiles={RESEARCH_TILES} />
          </section>
        </>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-ink-2">研究ツール</h2>
          <TileGrid tiles={RESEARCH_TILES} />
        </section>
      )}
    </div>
  );
}
