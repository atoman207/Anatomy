import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { getSessionContext } from "@/lib/auth/guards";
import { FREE_PEER_REVIEW_CREDITS, PEER_REVIEW_CREDIT_PACKS } from "@/lib/peerReview/creditPacks";
import { VoiceTranscribeChat } from "@/components/landing/VoiceTranscribeChat";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { SiteFooter } from "@/components/landing/SiteFooter";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "LABNOTE. — 記録ウィザードから統計・AI査読まで",
  description:
    "実験選択・試薬管理・テンプレート・音声入力・論文検索を一つの記録ウィザードにまとめ、PDFレポートまで自動作成。統計解析・AI査読・研究室管理も一つのプラットフォームで。",
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
 *
 * This copy mirrors the current schema/product exactly (see
 * supabase/migrations/all.sql and the /record wizard) rather than an earlier,
 * looser feature list: /notebook, /voice, /reagents, /experiments and
 * /literature are no longer separate destinations - each now redirects into
 * one 5-step /record wizard (実験選択 → 試薬・Lot → テンプレート → 実験ノート →
 * 論文検索) that ends by generating and storing a PDF. The feature cards and
 * flow section below describe that wizard, not the old standalone pages.
 *
 * Product screenshots: features uses `/2-bg.png`, AI-figures uses `/bg3.png`,
 * principles uses `/bg4.png`, dashboard uses `/bg5.png`, pricing uses
 * `/bg6.png`, and the closing CTA uses `/bg7.png`. Mood photography
 * (Unsplash) lives under `/landing/`.
 */

/** Fed into the hero's voice-transcription demo below, verbatim. */
const ABOUT_TEXT =
  "このサービスは、研究室の日々の実験記録から、統計解析・論文検索・投稿前のAI査読までを一つのアカウントで完結させる、" +
  "研究室単位のオールインワン研究基盤です。中心にあるのは「記録ウィザード」で、実験と試薬の選択、実験ノートテンプレートの作成、" +
  "音声によるノート起こし、AIによる図版生成、参考文献の検索・挿入までを一続きの流れとして進め、完了した瞬間にPDFレポートが自動で" +
  "作成・保存されます。作成したレポートはダッシュボードの先頭に「今日のラボレポート」として並び、実験ごとにまとめてもいつでも見返せます。";

interface Feature {
  href: string;
  title: string;
  lead: string;
  body: string;
}

/**
 * One card per pillar of the current product. Ordered the way a report
 * actually moves through /record (steps 1-5), then the surrounding tools
 * (organize/analyze), then AI査読, then research-room management.
 */
const FEATURES: Feature[] = [
  {
    href: "/record?step=1",
    title: "記録ウィザード",
    lead: "ひとつの流れで",
    body:
      "実験選択 → 試薬・Lot → テンプレート → 実験ノート → 論文検索の5ステップを順に進むだけ。各ステップの先頭に、これまで選んだ研究室・実験・試薬・テンプレートが常に表示され、いつでも前のステップに戻って修正できます。",
  },
  {
    href: "/record?step=2",
    title: "試薬・Lot管理",
    lead: "選ぶ、または登録する",
    body:
      "過去に登録した試薬とLot番号から選ぶか、その場で新規登録できます。登録した試薬は自動で選択され、実験ノートのLot欄に引き継がれます。",
  },
  {
    href: "/record?step=4",
    title: "音声入力",
    lead: "話すだけ",
    body:
      "実験台で話した内容をそのまま文字起こし。無料のブラウザ音声認識（日本語既定・英語も切替可）と、より高精度な有料エンジンを選べます。マイクは何度でも押し直せて、その都度これまでの文章に追記されます。",
  },
  {
    href: "/record?step=4",
    title: "AI画像生成",
    lead: "図をつくる",
    body:
      "ここまでの記録内容とプロンプトをもとに、BioRenderのような生物・生化学分野の模式図をAIが生成します。画像のアップロードや、過去に保存した図の再利用にも対応します。",
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
    href: "/record?step=5",
    title: "論文検索",
    lead: "調べる",
    body:
      "PubMedとCrossrefを横断して検索し、書誌情報を保存。記録した内容から自動でキーワードを組み立て、最も近い日本語・英語の論文を検索してレポートに参考文献として挿入できます。",
  },
  {
    href: "/peer-review",
    title: "AI査読",
    lead: "投稿前に備える",
    body:
      "3名のAI査読者が、方法・統計／新規性／論理構成をそれぞれ独立に評価します。投稿前に弱点と改善案がわかります。",
  },
  {
    href: "/labs",
    title: "研究室・監査ログ",
    lead: "共有し、証明する",
    body:
      "研究室単位でメンバーと役割を管理し、招待もそのまま送れます。誰が・いつ・何をしたかは追記のみの監査ログに残り、消すことも書き換えることもできません。",
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
      "確定した音声ノートはデータベース側で変更を拒否し、実験ノートは当日中のみ修正可能で、日をまたぐと変更を拒否します。「あの日の記録」を後から証明できます。",
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
      {/* Full-viewport hero: artwork is edge-to-edge; header floats on top so
          the first screen reads as one composition, not a boxed column. */}
      <section className="relative flex min-h-dvh w-full flex-col overflow-hidden bg-white">
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <Image
            src="/bg-m.png"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-top md:hidden"
          />
          <Image
            src="/background.png"
            alt=""
            fill
            priority
            sizes="100vw"
            className="hidden object-cover object-right md:block"
          />
        </div>

        <SiteHeader signedIn={signedIn} overHero />

        <div className="relative z-10 mx-auto flex w-full max-w-[1100px] flex-1 flex-col justify-center px-5 pb-16 pt-24 sm:px-8 sm:pb-20 sm:pt-28">
          <p className="text-[14px] font-medium tracking-[0.18em] text-ink-2">
            研究室のための記録・解析プラットフォーム
          </p>
          <h1 className="mt-4 max-w-[16ch] font-serif text-7xl font-semibold leading-[1.05] text-ink sm:text-8xl">
            今日の実験を話すだけで、
            <br />
            投稿前の査読まで。
          </h1>
          <p className="mt-6 max-w-[56ch] text-[16px] leading-relaxed text-ink-2 sm:text-lg">
            実験・試薬の選択から、音声入力によるノート作成、AI画像生成、類似論文の自動検索、統計解析、AI査読まで。
            研究室で散らばりがちな作業を一つの記録ウィザードにまとめ、完了と同時にPDFレポートとして保存します。
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
              className="rounded-md border border-line bg-white/70 px-6 py-3 text-[15px] font-medium text-ink backdrop-blur-sm transition-colors hover:bg-white"
            >
              できることを見る
            </Link>
            <Link
              href="/contact"
              className="rounded-md border border-line bg-white/70 px-6 py-3 text-[15px] font-medium text-ink backdrop-blur-sm transition-colors hover:bg-white"
            >
              お問い合わせ
            </Link>
          </div>

          <p className="mt-5 text-[14px] text-ink-3">
            AI査読は最初の{FREE_PEER_REVIEW_CREDITS}回まで無料。クレジットカードの登録は不要です。
          </p>
        </div>
      </section>

      {/* About: what this service currently is, in plain terms - demoed the
          same way the app itself takes it in, through voice. */}
      <section id="about" className="scroll-mt-8 border-b border-line bg-surface-1">
        <div className="mx-auto w-full max-w-[1100px] px-5 py-16 sm:px-8">
          <p className="mx-auto max-w-[70ch] text-center text-[13px] font-medium tracking-[0.14em] text-accent">
            話すだけで、記録になる
          </p>
          <VoiceTranscribeChat text={ABOUT_TEXT} />
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-8 border-b border-line bg-surface-1">
        <div className="mx-auto w-full max-w-[1100px] px-5 py-20 sm:px-8">
          <header className="max-w-[60ch]">
            <h2 className="font-serif text-3xl font-semibold text-ink">できること</h2>
            <p className="mt-3 text-[16px] leading-relaxed text-ink-2">
              ひとつの研究が、着想から投稿までに通る道筋にあわせて機能が並んでいます。
              どれも単体で使えますが、実験に紐づけると結果が一箇所に集まります。
            </p>
          </header>

          <div className="relative mt-10 aspect-[16/9] w-full overflow-hidden rounded-lg">
            <Image
              src="/2-bg.png"
              alt="記録ウィザードの画面イメージ"
              fill
              sizes="(max-width: 1100px) 100vw, 1100px"
              className="object-cover object-center"
            />
          </div>

          <div className="mt-12 grid gap-x-10 gap-y-11 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <article key={f.title} className="flex flex-col">
                <p className="text-[12px] font-medium tracking-wider text-accent">{f.lead}</p>
                <h3 className="mt-1.5 font-serif text-xl font-semibold text-ink">{f.title}</h3>
                <p className="mt-2.5 flex-1 text-[15px] leading-relaxed text-ink-2">{f.body}</p>
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

      {/* AI-generated figures, highlighted separately: the newest and most
          visually demonstrable feature, so it gets its own section with a
          sample image rather than one card among nine. */}
      <section className="border-b border-line">
        <div className="mx-auto grid w-full max-w-[1100px] items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-2">
          <div>
            <h2 className="font-serif text-3xl font-semibold text-ink">
              言葉から、論文用の模式図へ
            </h2>
            <p className="mt-3 text-[16px] leading-relaxed text-ink-2">
              実験ノートの内容と指示（プロンプト）から、生化学・生物学分野の模式図をAIが生成します。
              BioRenderで作るような、細胞・分子経路・実験フローの図を、既存の記録を土台にその場で作成できます。
              画像はアップロードでも追加でき、生成した図は他のレポートでも再利用できます。
            </p>
            <Link
              href={signedIn ? "/record?step=4" : "/login"}
              className="mt-8 inline-block rounded-md border border-line px-5 py-2.5 text-[14px] font-medium text-ink transition-colors hover:bg-surface-1"
            >
              実験ノートを開く
            </Link>
          </div>

          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg">
            <Image
              src="/bg3.png"
              alt="AIが生成したBioRender風の模式図の実例"
              fill
              sizes="(min-width: 1024px) 520px, 100vw"
              className="object-cover object-center"
            />
          </div>
        </div>
      </section>

      {/* Principles, with imagery */}
      <section className="border-b border-line bg-surface-1">
        <div className="mx-auto grid w-full max-w-[1100px] items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-2">
          <div>
            <h2 className="font-serif text-3xl font-semibold text-ink">
              「あとから書き換えていない」と言えること
            </h2>
            <p className="mt-3 text-[16px] leading-relaxed text-ink-2">
              研究記録に必要なのは、速さより、後から説明できることです。
              このアプリは、記録を消せない・書き換えられない仕組みをデータベース側に持たせています。
            </p>

            <dl className="mt-10 flex flex-col divide-y divide-[var(--border)]">
              {PRINCIPLES.map((p) => (
                <div key={p.title} className="py-5 first:pt-0 last:pb-0">
                  <dt className="text-[15px] font-medium text-ink">{p.title}</dt>
                  <dd className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{p.body}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="overflow-hidden rounded-lg border border-line">
            <Image
              src="/bg4.png"
              alt="改ざんできない研究記録の仕組みを示す画面イメージ"
              width={1200}
              height={800}
              sizes="(min-width: 1024px) 520px, 100vw"
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      </section>

      {/* Dashboard, as the place everything lands */}
      <section className="border-b border-line">
        <div className="mx-auto grid w-full max-w-[1100px] items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-2">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg">
            <Image
              src="/bg5.png"
              alt="ダッシュボード画面：今日のラボレポートと実験ごとの一覧"
              fill
              sizes="(min-width: 1024px) 520px, 100vw"
              className="object-cover object-center"
            />
          </div>

          <div>
            <h2 className="font-serif text-3xl font-semibold text-ink">
              今日の記録が、いちばん上に来る
            </h2>
            <p className="mt-3 text-[16px] leading-relaxed text-ink-2">
              記録ウィザードを完了すると、その日のうちはヘッダーの「今日の実験記録」ボタンからすぐ見返して修正できます。
              ダッシュボードを開けば、今日作成したラボレポートが常に先頭に並び、その下では過去の記録を実験ごとにまとめて
              確認できます。PDFはいつでも開いてダウンロードできます。
            </p>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-8 border-b border-line bg-surface-1">
        <div className="mx-auto grid w-full max-w-[1100px] items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-2">
          <div className="order-2 overflow-hidden rounded-lg border border-line lg:order-1">
            <Image
              src="/bg6.png"
              alt="無料で始められる機能とAI査読の料金プラン"
              width={1200}
              height={800}
              sizes="(min-width: 1024px) 520px, 100vw"
              className="h-full w-full object-cover"
            />
          </div>

          <div className="order-1 lg:order-2">
            <h2 className="font-serif text-3xl font-semibold text-ink">まず無料で試せます</h2>
            <p className="mt-3 text-[16px] leading-relaxed text-ink-2">
              記録ウィザード・データ整理・統計・論文検索は、アカウントを作ればそのまま使えます。
              AI査読だけは1回ごとの従量制で、最初の{FREE_PEER_REVIEW_CREDITS}回は無料です。
            </p>

            <ul className="mt-8 flex flex-col gap-3 text-[15px] leading-relaxed text-ink-2">
              {[
                `AI査読は最初の${FREE_PEER_REVIEW_CREDITS}回まで無料`,
                ...PEER_REVIEW_CREDIT_PACKS.map((p) =>
                  p.billingInterval === "month"
                    ? `${p.name} ¥${p.amountJpy.toLocaleString("ja-JP")} / 月`
                    : `${p.name} ¥${p.amountJpy.toLocaleString("ja-JP")}`,
                ),
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

      {/* Closing visual */}
      <section className="relative isolate min-h-[440px] overflow-hidden sm:min-h-[560px]">
        <Image
          src="/bg7.png"
          alt=""
          fill
          sizes="100vw"
          className="-z-10 object-cover"
        />
        <div aria-hidden className="absolute inset-0 -z-10 bg-black/40" />
      </section>

      <SiteFooter />
    </div>
  );
}
