import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth/guards";
import { FREE_PEER_REVIEW_CREDITS, PEER_REVIEW_CREDIT_PACKS } from "@/lib/peerReview/creditPacks";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { SampleReportsSection } from "@/components/help/SampleReportsSection";
import { SITE_URL } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ヘルプ・よくある質問",
  description: "記録ウィザード、音声入力、AI画像生成、AI査読、投稿用ファイルなど、LABNOTE の使い方に関するよくある質問。",
  alternates: { canonical: `${SITE_URL}/help` },
};

interface Faq {
  q: string;
  a: string;
}

interface Feature {
  title: string;
  body: string;
  /** A concrete, end-to-end walkthrough of the feature - not a restatement of `body`. */
  example: string;
}

/** One feature explained in prose, followed by a worked example in a callout. */
function FeatureBlock({ title, body, example, children }: Feature & { children?: ReactNode }) {
  return (
    <div>
      <h3 className="text-[17px] font-semibold text-ink">{title}</h3>
      <p className="mt-2 max-w-[64ch] text-[15px] leading-relaxed text-ink-2">{body}</p>
      <div className="mt-3 max-w-[64ch] rounded-lg border border-[var(--border)] bg-surface-1 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">例</p>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{example}</p>
      </div>
      {children}
    </div>
  );
}

const FEATURES: Feature[] = [
  {
    title: "記録ウィザード（実験記録の入り口）",
    body: "「実験選択」「試薬・Lot」「テンプレート」「実験ノート」「論文検索」の5ステップを順番に進むだけで、" +
      "その日のラボレポートが1件のPDFとして完成します。各ステップの先頭には、これまで選んだ研究室・実験・試薬・" +
      "テンプレートが常に表示され、途中のステップに戻って内容を直しても、後のステップの入力は消えません。",
    example: "実験室で細胞培養を終えたら、ヘッダーの「今日の実験記録」ボタンから記録ウィザードを開始。" +
      "① 実験「HeLa細胞 継代培養」を選択 → ② 使用したPBSとトリプシンのLotを登録 → " +
      "③「細胞培養・継代」テンプレートを選択 → ④ 目的・手順・結果を入力（音声入力も可）→ " +
      "⑤ 関連する既存の論文を検索して添付、で完了です。完了と同時にPDFレポートが自動で保存されます。",
  },
  {
    title: "テンプレート（実験ノートのひな形）",
    body: "汎用実験ノートのほか、ウェスタンブロット・RT-qPCR・ELISA・フローサイトメトリーなど、" +
      "研究分野ごとに項目があらかじめ用意された組み込みテンプレートが選べます。研究室ごとに独自の" +
      "「カスタムテンプレート」を作ることもでき、実験ノートの画面から自分で作成・編集できるほか、" +
      "研究室の管理者は「管理画面 → テンプレート」から研究室共通のひな形として用意できます。",
    example: "ウェスタンブロットのテンプレートを選ぶと、「溶解バッファー」「アプライ量」「ゲル濃度」" +
      "「一次抗体」「二次抗体」「レーン割当」といった項目が最初から並んでいるので、抜け漏れなく記録できます。" +
      "実際にこのテンプレートから作成されたレポートPDFの例は、下の「テンプレートを見る」から確認できます。",
  },
  {
    title: "音声入力",
    body: "実験ノートのステップでは、キーボード入力の代わりにマイクへ話しかけて記録できます。既定は日本語で、" +
      "英語（en-US）にも切り替え可能です。マイクは何度でも押し直すことができ、そのたびに書き起こしが今までの" +
      "文章に追記されます。無料のブラウザ標準の音声認識に加え、より高精度な有料エンジンも選べます。",
    example: "実験の手を止めずに「トリプシン処理を3分間、37度で行った。細胞の剥離を顕微鏡で確認した」と話すと、" +
      "その内容がそのまま文字起こしされ、AIが自動で「手順」「結果」などの項目に振り分けた下書きを作成します。",
  },
  {
    title: "AI画像生成・図の管理",
    body: "実験ノートの内容と自分で入力したプロンプトをもとに、細胞・分子経路・実験フローなどの模式図をAIが生成し、" +
      "そのままレポートに挿入できます。自分で撮影・作成した画像のアップロードや、統計解析（/analyze）で作った" +
      "グラフをノートに挿入する使い方にも対応しています。",
    example: "「シグナル伝達経路（リガンド結合からERK活性化まで）を示す模式図」とプロンプトを入力すると、" +
      "矢印でつながった経路図が生成されます。気に入らなければプロンプトを変えて作り直し、良ければそのまま" +
      "レポート本文に挿入して図番号とキャプションが自動で付きます。",
  },
  {
    title: "AI査読",
    body: "方法・統計／研究内容・新規性／論文構成を専門に見る3名のAI査読者が、それぞれ独立に論文を評価します。" +
      "最初の数回は無料で、以降はクレジットを購入して利用します。投稿予定の水準（トップジャーナル基準／" +
      "一般的な国際誌基準）や、査読者ごとの性格（厳格型・建設的型など）も指定できます。",
    example: "改訂前の論文PDFをアップロードして最初のAI査読を実行し、指摘に沿って修正した後、" +
      "「再査読」として最初の査読を選んで再実行すると、総合評価・カテゴリ別評価が前回よりどれだけ" +
      "改善したかをグラフと数値で確認できます。",
  },
  {
    title: "投稿用ファイル（Figure・Table・Video・Article）",
    body: "多くのジャーナルは図表・動画・原稿を本文とは別ファイルで提出する形式を求めます。記録ウィザードの" +
      "「実験ノート」ステップにある「投稿用ファイル」の欄から、Figure（図）・Table（表）・Video（動画）・" +
      "Article（原稿）をそれぞれ登録でき、同じ実験の記録すべてで共有されます（1日あたり10MBまで）。",
    example: "投稿用の最終図（Figure 1.tif）と統計表（Table 1.xlsx）をそれぞれ「Figure」「Table」として" +
      "アップロードしておくと、その実験に関わったメンバーの誰もが、後日投稿の準備をするときに同じ場所から" +
      "取り出せます。",
  },
  {
    title: "レポートPDF・ダッシュボード",
    body: "記録ウィザードを完了すると、その内容が自動でPDFレポートとして保存されます。ダッシュボードの先頭には" +
      "「今日のラボレポート」が並び、その日のうちはヘッダーの「今日の実験記録」ボタンからすぐに開いて修正でき、" +
      "過去の記録は実験ごとにまとめて確認できます。",
    example: "先週作成した「RT-qPCR」のレポートを見返したいときは、ダッシュボードから該当の実験を開き、" +
      "実験ノートの履歴一覧から日付を選んで「表示」を押すと、その日に確定した内容とPDFをそのまま確認できます。",
  },
  {
    title: "確定・監査ログ（改ざん防止）",
    body: "確定済みの音声ノートは、その後どの操作からも変更できません。実験ノートは作成した当日中のみ修正でき、" +
      "日をまたぐと変更できなくなります。誰が・いつ・何をしたかは監査ログに追記される一方で、監査ログ自体は" +
      "後から編集・削除できません。",
    example: "8月20日に作成した実験ノートに書き忘れがあっても、8月21日以降は編集ボタンが表示されなくなります。" +
      "その場合は新しい実験ノートとして追記し、いつ・誰が追記したかが監査ログに残ります。",
  },
  {
    title: "研究室・メンバー管理",
    body: "研究室ページからメンバーを招待できます。すでにアカウントのある相手はすぐに追加され、未登録の" +
      "メールアドレスには招待が保留され、相手が登録した時点で自動的にその研究室のメンバーになります。" +
      "役割（オーナー・管理者・メンバー・閲覧者）に応じて、書き込みや招待の権限が変わります。",
    example: "新しく配属された学生のメールアドレスをまだアカウント登録前に招待しておくと、後日その学生が" +
      "サインアップした瞬間に、招待した研究室のメンバーとして自動的に参加できます。",
  },
  {
    title: "研究室チャット",
    body: "研究室のメンバー同士でやり取りできるチャット機能です。研究室内の公開チャンネルに加え、" +
      "管理者が作成できる非公開チャンネル、メンバー間のダイレクトメッセージ、音声・映像通話に対応しています。",
    example: "実験結果を相談したいときは「#解析」チャンネルに画像を添付して投稿したり、担当者に直接" +
      "ダイレクトメッセージを送って、必要ならそのままビデオ通話に切り替えて画面を見せながら相談できます。",
  },
];

export default async function HelpPage() {
  const ctx = await getSessionContext();
  const signedIn = Boolean(ctx);

  const FAQS: Faq[] = [
    {
      q: "記録ウィザードとは何ですか？",
      a: "実験選択 → 試薬・Lot → テンプレート → 実験ノート → 論文検索の5ステップを順に進む、実験記録の入り口です。" +
        "各ステップの先頭に、これまで選んだ研究室・実験・試薬・テンプレートが常に表示され、いつでも前のステップに戻って修正できます。" +
        "完了すると、その内容がPDFレポートとして自動で保存されます。",
    },
    {
      q: "音声入力はどの言語に対応していますか？",
      a: "既定は日本語です。ステップの中で英語（en-US）に切り替えることもできます。マイクは何度でも押し直せて、" +
        "そのたびにこれまでの文章へ追記されます。無料のブラウザ音声認識のほか、より高精度な有料エンジンも選べます。",
    },
    {
      q: "AI画像生成はどんな画像を作れますか？",
      a: "実験ノートの内容と入力したプロンプトをもとに、生物・生化学分野の模式図（細胞・分子経路・実験フローなど）を生成します。" +
        "自分で撮影・作成した画像のアップロードや、過去に保存した図の再利用にも対応しています。",
    },
    {
      q: "AI査読は無料で使えますか？",
      a: `最初の${FREE_PEER_REVIEW_CREDITS}回は無料です。それ以降は ` +
        PEER_REVIEW_CREDIT_PACKS.map((p) =>
          p.billingInterval === "month"
            ? `${p.name} ¥${p.amountJpy.toLocaleString("ja-JP")} / 月`
            : `${p.name} ¥${p.amountJpy.toLocaleString("ja-JP")}`,
        ).join("、") +
        " からご利用いただけます。",
    },
    {
      q: "AI査読の評価基準や査読者の性格は選べますか？",
      a: "投稿予定の水準に合わせて「トップジャーナル基準（Nature/Science/Cellクラス相当）」と「一般的な国際誌基準」の" +
        "2種類から評価の厳しさを選べます。また、方法・統計／研究内容・新規性／論文構成の3名の査読者ごとに、厳格型・建設的型・" +
        "簡潔型・懐疑的型・丁寧型・温和型といった性格（口調）を指定でき、ランダムに設定することもできます。",
    },
    {
      q: "投稿先ジャーナルへの採択可能性はわかりますか？",
      a: "投稿予定のジャーナル名を入力すると、想定されるImpact Factorのレンジ、分野に合った推奨ジャーナル、" +
        "そのジャーナルへの採択可能性（％の目安）を表示します。ジャーナルの投稿要項ページのURLを貼り付ければ、" +
        "論文の形式が要項と合っているかも確認できます。いずれもAIによる目安であり、実際の査読結果・採否を保証するものではありません。",
    },
    {
      q: "修正前後でスコアの変化を比較できますか？",
      a: "AI査読を実行する際に「再査読」として以前の査読を選ぶと、以前の版から今回までの総合評価・カテゴリ別評価の推移を" +
        "グラフと一覧で確認できます。修正のたびに査読を重ねることで、改善の度合いを数値で追えます。",
    },
    {
      q: "論文用のFigure・Table・動画はどこで管理しますか？",
      a: "多くのジャーナルは、図表・動画・原稿を本文とは別ファイルで提出する形式を求めます。記録ウィザードの" +
        "「実験ノート」ステップに、Figure（図）・Table（表）・Video（動画）・Article（原稿）を分けて登録できる" +
        "「投稿用ファイル」の欄があり、実験全体で共有されます。1日あたりのアップロード容量には上限（10MB）があります。",
    },
    {
      q: "作成したレポートはどこで確認できますか？",
      a: "ダッシュボードの先頭に「今日のラボレポート」として並びます。その日のうちはヘッダーの「今日の実験記録」ボタンから" +
        "すぐに開いて修正でき、過去の記録は実験ごとにまとめて確認できます。PDFはいつでも開いてダウンロードできます。",
    },
    {
      q: "一度確定した記録は書き換えられますか？",
      a: "確定済みの音声ノートは変更できません。実験ノートは作成した当日中のみ修正でき、日をまたぐと変更できなくなります。" +
        "誰が・いつ・何をしたかは監査ログに追記され、後から編集・削除もできません。",
    },
    {
      q: "研究室にメンバーを追加するには？",
      a: "研究室ページからメンバーを招待できます。既にアカウントのある相手はすぐに追加され、未登録のメールアドレスには" +
        "招待が保留され、相手が登録した時点で自動的にその研究室のメンバーになります。",
    },
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-surface-0 [--text-primary:#000] [--text-secondary:#000] [--text-muted:#000]">
      <SiteHeader signedIn={signedIn} />

      <main className="mx-auto w-full max-w-[840px] flex-1 px-5 py-16 sm:px-8">
        <h1 className="font-serif text-3xl font-semibold text-ink">ヘルプ・使い方ガイド</h1>
        <p className="mt-3 max-w-[64ch] text-[15px] leading-relaxed text-ink-2">
          LABNOTE. でできることを、実際の使い方の例とあわせて説明します。ここに載っていない内容は、
          <Link href={signedIn ? "/dashboard" : "/login"} className="text-accent underline underline-offset-2">
            {signedIn ? "ダッシュボード" : "ログイン後の画面"}
          </Link>
          の各ページからも確認できます。
        </p>

        <section className="mt-12">
          <h2 className="font-serif text-2xl font-semibold text-ink">主な機能</h2>
          <div className="mt-6 flex flex-col divide-y divide-[var(--border)]">
            {FEATURES.map((f) => (
              <div key={f.title} className="py-7 first:pt-0 last:pb-0">
                <FeatureBlock {...f}>
                  {f.title.startsWith("テンプレート") && <SampleReportsSection />}
                </FeatureBlock>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-14">
          <h2 className="font-serif text-2xl font-semibold text-ink">よくある質問</h2>
          <div className="mt-4 flex flex-col divide-y divide-[var(--border)]">
            {FAQS.map((f) => (
              <details key={f.q} className="py-5 first:pt-0 last:pb-0">
                <summary className="cursor-pointer list-none text-[16px] font-medium text-ink marker:content-none">
                  {f.q}
                </summary>
                <p className="mt-2.5 text-[15px] leading-relaxed text-ink-2">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
