import Link from "next/link";
import { Card, Callout, Badge } from "@/components/ui";
import { HealthPanel } from "@/components/HealthPanel";

const FEATURES = [
  {
    href: "/organize",
    title: "データ整理",
    items: [
      "Rawファイル一覧作成 — 重複・サイズ・命名規則のチェック付きインベントリ",
      "サンプルシート作成 — 群、生物学的不応、バッチ、実行順序を検証",
      "ファイル名変更 — 衝突回避プレビュー付きルールベース一括リネーム",
    ],
  },
  {
    href: "/analyze",
    title: "統計解析",
    items: [
      "t検定 — Welch、Student、対応あり、Mann-Whitney",
      "ANOVA — 一元配置、Tukey HSD、Kruskal-Wallis",
      "PCA — スコア、ローディング、説明分散",
      "クラスタリング — k-means、階層的クラスタリング、シルエット",
    ],
  },
  {
    href: "/analyze",
    title: "図作成",
    items: [
      "Volcano plot — 倍数変化とFDR制御有意性",
      "Heatmap — 行zスコア、行・列デンドログラム",
      "PCA plot — 群色、マーカー形状、95%楕円",
    ],
  },
  {
    href: "/notebook",
    title: "実験ノート自動化",
    items: [
      "テンプレート作成 — 繰り返し実験用の再利用可能テンプレート",
      "測定情報取り込み — サンプル数とシートを自動連携",
      "結果貼り付け — 任意の結果をキューに入れ、Markdownエントリを一括エクスポート",
    ],
  },
];

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          研究データ管理
        </h1>
        <p className="mt-1.5 max-w-3xl text-sm text-ink-2">
          Rawファイルの整理、標準統計解析、論文用図の作成、実験ノートの更新を一貫して行えます。
          統計・作図はすべてブラウザ内で実行され、データベースは保存を選択した場合のみ使用されます。
        </p>
      </header>

      <HealthPanel />

      <div className="grid gap-4 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <Link key={f.title} href={f.href} className="group">
            <Card
              className="h-full transition-colors group-hover:border-line-strong"
              title={f.title}
            >
              <ul className="flex flex-col gap-1.5 text-xs text-ink-2">
                {f.items.map((it) => (
                  <li key={it} className="flex gap-2">
                    <span aria-hidden className="text-accent">•</span>
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </Link>
        ))}
      </div>

      <Card title="はじめ方">
        <ol className="flex flex-col gap-2 text-sm text-ink-2">
          <li>
            <Badge tone="accent">1</Badge>{" "}
            <Link href="/analyze" className="text-accent underline">
              統計・図
            </Link>{" "}
            → <strong>デモデータ</strong>
            を読み込んで、ファイルやログインなしですべての機能をすぐ確認できます。
          </li>
          <li>
            <Badge tone="accent">2</Badge>{" "}
            <Link href="/organize" className="text-accent underline">
              データ整理
            </Link>{" "}
            → Rawファイルを追加してインベントリとサンプルシートを作成します。
          </li>
          <li>
            <Badge tone="accent">3</Badge>{" "}
            解析を実行し、各結果を{" "}
            <Link href="/notebook" className="text-accent underline">
              実験ノート
            </Link>{" "}
            に送ってエントリをエクスポートします。
          </li>
        </ol>
      </Card>

      <Callout tone="info" title="データの取り扱い">
        開いたファイルは内容とファイル名のみブラウザ内で読み込まれます。明示的にデータベースへ保存しない限り、外部へ送信されることはありません。
        Excelブックのみ例外で、サーバー上で解析後、レスポンス直後に破棄されます。
      </Callout>
    </div>
  );
}
