import Link from "next/link";
import { Card, Callout, Badge } from "@/components/ui";
import { HealthPanel } from "@/components/HealthPanel";

const FEATURES = [
  {
    href: "/organize",
    title: "データ整理",
    en: "Data organization",
    items: [
      "Rawファイル一覧作成 — inventory with duplicate, size and naming checks",
      "サンプルシート作成 — groups, replicates, batch and run order, validated",
      "ファイル名変更 — rule-based batch rename with collision-safe preview",
    ],
  },
  {
    href: "/analyze",
    title: "統計解析",
    en: "Statistics",
    items: [
      "t検定 — Welch, Student, paired, and Mann-Whitney",
      "ANOVA — one-way with Tukey HSD and Kruskal-Wallis",
      "PCA — scores, loadings and explained variance",
      "クラスタリング — k-means and hierarchical with silhouette",
    ],
  },
  {
    href: "/analyze",
    title: "図作成",
    en: "Figures",
    items: [
      "Volcano plot — fold change against FDR-controlled significance",
      "Heatmap — row z-scores with row and column dendrograms",
      "PCA plot — group colours, marker shapes and 95% ellipses",
    ],
  },
  {
    href: "/notebook",
    title: "実験ノート自動化",
    en: "Notebook automation",
    items: [
      "テンプレート作成 — reusable templates for recurring experiments",
      "測定情報取り込み — sample counts and sheets flow in automatically",
      "結果貼り付け — queue any result and export one Markdown entry",
    ],
  },
];

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          chondro — 研究データ管理
        </h1>
        <p className="mt-1.5 max-w-3xl text-sm text-ink-2">
          Organize raw files, run the standard statistics, produce publication figures, and
          keep the experiment notebook in step. Statistics and plotting run entirely in your
          browser; the database is only used when you choose to save.
        </p>
      </header>

      <HealthPanel />

      <div className="grid gap-4 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <Link key={f.title + f.en} href={f.href} className="group">
            <Card
              className="h-full transition-colors group-hover:border-line-strong"
              title={
                <span className="flex items-center gap-2">
                  {f.title}
                  <span className="text-xs font-normal text-ink-3">{f.en}</span>
                </span>
              }
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

      <Card title="はじめ方 / Getting started">
        <ol className="flex flex-col gap-2 text-sm text-ink-2">
          <li>
            <Badge tone="accent">1</Badge>{" "}
            <Link href="/analyze" className="text-accent underline">
              統計・図 / Analyze
            </Link>{" "}
            → <strong>デモデータ / Load demo data</strong> to see every feature working
            immediately, with no file or login needed.
          </li>
          <li>
            <Badge tone="accent">2</Badge>{" "}
            <Link href="/organize" className="text-accent underline">
              データ整理 / Organize
            </Link>{" "}
            → add your raw files to build an inventory and a sample sheet.
          </li>
          <li>
            <Badge tone="accent">3</Badge> Run the analyses, then send each result to the{" "}
            <Link href="/notebook" className="text-accent underline">
              実験ノート / Notebook
            </Link>{" "}
            and export one entry.
          </li>
        </ol>
      </Card>

      <Callout tone="info" title="Data handling">
        Files you open are read in the browser for their contents and names only. Nothing is
        transmitted anywhere unless you explicitly save to the database. Excel workbooks are the
        one exception: they are parsed on the server and discarded immediately after the response.
      </Callout>
    </div>
  );
}
