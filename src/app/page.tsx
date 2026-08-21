import Link from "next/link";
import { Badge, Callout, Card } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { getSessionContext } from "@/lib/auth/guards";
import { PLATFORM_ROLE_LABELS } from "@/lib/auth/roles";

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
  { href: "/organize", title: "データ整理", description: "ファイル名の整理とサンプルシート作成。", icon: "folder" },
  { href: "/analyze", title: "統計・図", description: "検定・多変量解析と作図。", icon: "chart" },
  { href: "/voice", title: "音声メモ", description: "音声から実験ノートを起こす。", icon: "mic" },
  { href: "/notebook", title: "実験ノート", description: "テンプレートから記録を作成。", icon: "notebook" },
  { href: "/literature", title: "論文検索", description: "PubMed・Crossref を検索して保存。", icon: "search" },
  { href: "/experiments", title: "実験一覧", description: "所属研究室の実験を一覧。", icon: "file" },
  { href: "/calculator", title: "計算ツール", description: "希釈・モル濃度などの計算。", icon: "calculator" },
  { href: "/reagents", title: "試薬・Lot", description: "試薬とロット番号の記録。", icon: "reagents" },
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

export default async function DashboardPage(props: PageProps<"/">) {
  const [ctx, search] = await Promise.all([getSessionContext(), props.searchParams]);
  const denied = typeof search.denied === "string" ? search.denied : null;
  const isAdmin = ctx?.isPlatformAdmin ?? false;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl font-semibold text-ink">
          {isAdmin ? "管理コンソール" : "研究データ管理"}
        </h1>
        {ctx && (
          <Badge tone={isAdmin ? "accent" : "neutral"}>
            {PLATFORM_ROLE_LABELS[ctx.platformRole].ja}
          </Badge>
        )}
      </header>

      {denied === "admin" && (
        <Callout tone="warn" title="管理者専用">
          そのページは管理者のみが利用できます。権限が必要な場合は管理者に依頼してください。
        </Callout>
      )}

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
        <TileGrid tiles={RESEARCH_TILES} />
      )}
    </div>
  );
}
