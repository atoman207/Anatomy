import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { getSessionContext } from "@/lib/auth/guards";
import { FREE_PEER_REVIEW_CREDITS } from "@/lib/peerReview/creditPacks";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "研究データ管理 — 実験ノートから統計・AI査読まで",
  description:
    "実験ノート、データ整理、統計解析、論文検索、AI査読。研究室の記録と解析をひとつにまとめるプラットフォームです。",
};

/*
 * The public front door.
 *
 * Everything else in this app is behind a session; this page is the only
 * thing an anonymous visitor sees, so it has to answer "what is this and is
 * it for me" without a login. It renders outside the application chrome (see
 * AppShell) and brings its own header and footer.
 *
 * Photography is licensed under the Unsplash License (free for commercial
 * use, no attribution required); the files are vendored into /public/landing
 * rather than hot-linked so the page does not depend on a third-party CDN
 * staying up. Credits are kept in the footer as a courtesy, and in
 * public/landing/CREDITS.md alongside the files.
 */

interface Feature {
  href: string;
  title: string;
  lead: string;
  body: string;
}

/** One card per pillar of the product, in the order a study actually moves. */
const FEATURES: Feature[] = [
  {
    href: "/notebook",
    title: "実験ノート",
    lead: "記録する",
    body:
      "テンプレートから実験記録を作成し、前回の条件をそのまま引き継げます。保存した記録は追記のみで、後から書き換わることはありません。",
  },
  {
    href: "/voice",
    title: "音声メモ",
    lead: "話すだけ",
    body:
      "手が塞がっていても、実験台で話した内容をそのまま文字起こしし、AIが実験ノートの形に整えます。",
  },
  {
    href: "/organize",
    title: "データ整理",
    lead: "散らかさない",
    body:
      "測定機器が吐き出したファイル名を一括で整理し、サンプルシートを作成します。命名の揺れや抜けはその場で指摘します。",
  },
  {
    href: "/analyze",
    title: "統計・作図",
    lead: "解析する",
    body:
      "t検定・分散分析から主成分分析・クラスタリングまで。結果はそのまま論文用の図として書き出せます。",
  },
  {
    href: "/literature",
    title: "論文検索",
    lead: "調べる",
    body:
      "PubMed と Crossref を横断して検索し、書誌情報を実験に紐づけて保存します。引用形式はそのまま使えます。",
  },
  {
    href: "/peer-review",
    title: "AI査読",
    lead: "投稿前に備える",
    body:
      "3名のAI査読者が、方法・統計／新規性／論理構成をそれぞれ独立に評価します。投稿前に弱点と改善案がわかります。",
  },
];

/** Answers "why not just a shared folder and a spreadsheet?" */
const PRINCIPLES: { title: string; body: string }[] = [
  {
    title: "研究室単位で共有する",
    body:
      "データは研究室に属します。メンバーを招待すれば、実験・データセット・ノートをそのまま共有できます。権限は役割ごとに分かれています。",
  },
  {
    title: "記録は書き換わらない",
    body:
      "確定した音声ノートはデータベース側で変更を拒否し、実験ノートは追記のみ。「あの日の記録」を後から証明できます。",
  },
  {
    title: "操作はすべて残る",
    body:
      "誰が・いつ・何をしたかは監査ログに追記され、編集も削除もできません。研究不正の疑いに事実で答えられます。",
  },
];

export default async function LandingPage() {
  // The page is public, so a missing session is the normal case - it only
  // decides whether the calls to action say "始める" or "ダッシュボードへ".
  const ctx = await getSessionContext();
  const signedIn = Boolean(ctx);

  return (
    // `auto-phrase` breaks Japanese lines at phrase boundaries instead of
    // anywhere, so a word like 研究室 is not split across two lines. Browsers
    // that do not support it fall back to the normal behaviour.
    <div className="flex min-h-dvh flex-col bg-surface-0 [word-break:auto-phrase]">
      <SiteHeader signedIn={signedIn} />

      {/* Hero */}
      <section className="relative isolate overflow-hidden">
        <Image
          src="/landing/fuji.jpg"
          alt="夕暮れの富士山と、麓に広がる街並み（静岡県富士宮市）"
          fill
          priority
          sizes="100vw"
          className="-z-10 object-cover"
        />
        {/* Keeps the headline legible over the photograph in both themes. */}
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-black/75 via-black/60 to-black/80" />

        <div className="mx-auto w-full max-w-[1100px] px-5 py-24 sm:px-8 sm:py-32">
          <p className="text-[13px] font-medium tracking-[0.18em] text-white/80">
            研究データ管理プラットフォーム
          </p>
          <h1 className="mt-4 max-w-[20ch] font-serif text-4xl font-semibold leading-tight text-white sm:text-5xl">
            実験の記録から、
            <br />
            投稿前の査読まで。
          </h1>
          <p className="mt-6 max-w-[52ch] text-[15px] leading-relaxed text-white/85 sm:text-base">
            実験ノート、データ整理、統計解析、論文検索、AI査読。
            研究室で散らばりがちな作業をひとつにまとめ、記録が後から書き換わらない形で残します。
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href={signedIn ? "/dashboard" : "/login"}
              className="rounded-md bg-accent px-6 py-3 text-[15px] font-medium text-accent-contrast transition-opacity hover:opacity-90"
            >
              {signedIn ? "ダッシュボードへ" : "無料で始める"}
            </Link>
            <Link
              href="#features"
              className="rounded-md border border-white/40 px-6 py-3 text-[15px] font-medium text-white transition-colors hover:bg-white/10"
            >
              できることを見る
            </Link>
          </div>

          <p className="mt-5 text-[13px] text-white/70">
            AI査読は最初の{FREE_PEER_REVIEW_CREDITS}回まで無料。クレジットカードの登録は不要です。
          </p>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-8 border-b border-line bg-surface-1">
        <div className="mx-auto w-full max-w-[1100px] px-5 py-20 sm:px-8">
          <header className="max-w-[60ch]">
            <h2 className="font-serif text-3xl font-semibold text-ink">できること</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
              ひとつの研究が、着想から投稿までに通る道筋にあわせて機能が並んでいます。
              どれも単体で使えますが、実験に紐づけると結果が一箇所に集まります。
            </p>
          </header>

          <div className="mt-12 grid gap-x-10 gap-y-11 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <article key={f.href} className="flex flex-col">
                <p className="text-[12px] font-medium tracking-wider text-accent">{f.lead}</p>
                <h3 className="mt-1.5 font-serif text-xl font-semibold text-ink">{f.title}</h3>
                <p className="mt-2.5 flex-1 text-[14px] leading-relaxed text-ink-2">{f.body}</p>
                <Link
                  href={f.href}
                  className="mt-4 w-fit text-[13px] font-medium text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent"
                >
                  {f.title}を開く
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Principles, with imagery */}
      <section className="border-b border-line">
        <div className="mx-auto grid w-full max-w-[1100px] items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-2">
          <div>
            <h2 className="font-serif text-3xl font-semibold text-ink">
              「あとから書き換えていない」と言えること
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
              研究記録に必要なのは、速さより、後から説明できることです。
              このアプリは、記録を消せない・書き換えられない仕組みをデータベース側に持たせています。
            </p>

            <dl className="mt-10 flex flex-col divide-y divide-[var(--border)]">
              {PRINCIPLES.map((p) => (
                <div key={p.title} className="py-5 first:pt-0 last:pb-0">
                  <dt className="text-[15px] font-medium text-ink">{p.title}</dt>
                  <dd className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{p.body}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="overflow-hidden rounded-lg border border-line">
            <Image
              src="/landing/torii-kyoto.jpg"
              alt="伏見稲荷大社の千本鳥居（京都市伏見区）"
              width={1200}
              height={800}
              sizes="(min-width: 1024px) 520px, 100vw"
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="border-b border-line bg-surface-1">
        <div className="mx-auto grid w-full max-w-[1100px] items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-2">
          <div className="order-2 overflow-hidden rounded-lg border border-line lg:order-1">
            <Image
              src="/landing/sakura-kyoto.jpg"
              alt="大沢池のほとりに咲く桜（京都市右京区）"
              width={1200}
              height={800}
              sizes="(min-width: 1024px) 520px, 100vw"
              className="h-full w-full object-cover"
            />
          </div>

          <div className="order-1 lg:order-2">
            <h2 className="font-serif text-3xl font-semibold text-ink">まず無料で試せます</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
              実験ノート・データ整理・統計・論文検索は、アカウントを作ればそのまま使えます。
              AI査読だけは1回ごとの従量制で、最初の{FREE_PEER_REVIEW_CREDITS}回は無料です。
            </p>

            <ul className="mt-8 flex flex-col gap-3 text-[14px] leading-relaxed text-ink-2">
              {[
                `AI査読は最初の${FREE_PEER_REVIEW_CREDITS}回まで無料`,
                "以降は使った回数だけの支払い。定額の縛りはありません",
                "まとめ買いのセットも用意しています",
              ].map((line) => (
                <li key={line} className="flex gap-2.5">
                  <span aria-hidden className="mt-[2px] text-accent">✓</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            <Link
              href={signedIn ? "/peer-review" : "/login"}
              className="mt-9 inline-block rounded-md bg-accent px-6 py-3 text-[15px] font-medium text-accent-contrast transition-opacity hover:opacity-90"
            >
              {signedIn ? "AI査読を試す" : "アカウントを作成する"}
            </Link>
          </div>
        </div>
      </section>

      {/* Closing call to action */}
      <section className="relative isolate overflow-hidden">
        <Image
          src="/landing/tokyo-night.jpg"
          alt="夜の東京タワーと都心の街並み（東京都港区）"
          fill
          sizes="100vw"
          className="-z-10 object-cover"
        />
        <div aria-hidden className="absolute inset-0 -z-10 bg-black/70" />

        <div className="mx-auto w-full max-w-[1100px] px-5 py-24 text-center sm:px-8">
          <h2 className="font-serif text-3xl font-semibold text-white sm:text-4xl">
            今日の実験から、記録を残しませんか
          </h2>
          <p className="mx-auto mt-4 max-w-[46ch] text-[15px] leading-relaxed text-white/85">
            アカウント作成後すぐに使い始められます。個人用のワークスペースは自動で用意されます。
          </p>
          <Link
            href={signedIn ? "/dashboard" : "/login"}
            className="mt-9 inline-block rounded-md bg-accent px-8 py-3.5 text-[15px] font-medium text-accent-contrast transition-opacity hover:opacity-90"
          >
            {signedIn ? "ダッシュボードへ" : "無料で始める"}
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

function SiteHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface-1/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1100px] items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/LOGO.png"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 rounded-md object-contain"
          />
          <span className="text-[15px] font-semibold text-ink">研究データ管理</span>
        </Link>

        <nav className="flex items-center gap-2 sm:gap-5">
          <Link
            href="#features"
            className="hidden text-[14px] text-ink-2 transition-colors hover:text-ink sm:block"
          >
            できること
          </Link>
          {signedIn ? (
            <Link
              href="/dashboard"
              className="rounded-md bg-accent px-4 py-2 text-[14px] font-medium text-accent-contrast transition-opacity hover:opacity-90"
            >
              ダッシュボード
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="text-[14px] text-ink-2 transition-colors hover:text-ink"
              >
                ログイン
              </Link>
              <Link
                href="/login"
                className="rounded-md bg-accent px-4 py-2 text-[14px] font-medium text-accent-contrast transition-opacity hover:opacity-90"
              >
                無料で始める
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line bg-surface-1">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-3 px-5 py-8 text-[12px] text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p>保存するまで、データは外部へ送信されません。</p>
        <p>
          写真: Unsplash（Marina Konno／Ryuta／Sarmat Batagov／T Y）
        </p>
      </div>
    </footer>
  );
}
