import type { Metadata } from "next";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth/guards";
import { FREE_PEER_REVIEW_CREDITS, PEER_REVIEW_CREDIT_PACKS } from "@/lib/peerReview/creditPacks";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { SiteFooter } from "@/components/landing/SiteFooter";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ヘルプ — LABNOTE.",
};

interface Faq {
  q: string;
  a: string;
}

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
    <div className="flex min-h-dvh flex-col bg-surface-0">
      <SiteHeader signedIn={signedIn} />

      <main className="mx-auto w-full max-w-[760px] flex-1 px-5 py-16 sm:px-8">
        <h1 className="font-serif text-3xl font-semibold text-ink">ヘルプ</h1>
        <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-ink-2">
          よくある質問をまとめました。ここに載っていない内容は、
          <Link href={signedIn ? "/dashboard" : "/login"} className="text-accent underline underline-offset-2">
            {signedIn ? "ダッシュボード" : "ログイン後の画面"}
          </Link>
          の各ページからも確認できます。
        </p>

        <div className="mt-10 flex flex-col divide-y divide-[var(--border)]">
          {FAQS.map((f) => (
            <details key={f.q} className="group py-5 first:pt-0 last:pb-0">
              <summary className="cursor-pointer list-none text-[16px] font-medium text-ink marker:content-none">
                <span className="inline-flex w-full items-center justify-between gap-3">
                  {f.q}
                  <span aria-hidden className="shrink-0 text-ink-3 transition-transform group-open:rotate-45">
                    ＋
                  </span>
                </span>
              </summary>
              <p className="mt-2.5 text-[15px] leading-relaxed text-ink-2">{f.a}</p>
            </details>
          ))}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
