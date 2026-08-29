import type { Metadata } from "next";
import { getSessionContext } from "@/lib/auth/guards";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { SITE_URL } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "利用規約",
  description: "LABNOTE の利用規約。アカウント登録、データの取り扱い、AI査読の料金、免責事項について定めています。",
  alternates: { canonical: `${SITE_URL}/terms` },
};

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "第1条（適用）",
    body: [
      "本規約は、LABNOTE（以下「本サービス」といいます）の利用条件を定めるものです。" +
        "利用者は、本規約に同意のうえ、本サービスを利用するものとします。",
    ],
  },
  {
    title: "第2条（アカウント登録）",
    body: [
      "本サービスの利用には、有効なメールアドレスによるアカウント登録が必要です。" +
        "登録情報が正確であることは利用者の責任とし、アカウントの管理不備によって生じた損害について、" +
        "本サービスは責任を負わないものとします。",
    ],
  },
  {
    title: "第3条（データの取り扱い）",
    body: [
      "利用者が入力した実験記録・試薬情報・画像・論文情報・投稿用ファイル（Figure・Table・Video・Article）等のデータは、" +
        "当該データを入力した研究室に帰属し、その研究室のメンバーのみが閲覧・編集できます。",
      "確定済みの音声ノート、および作成日を過ぎた実験ノートは、データベース側の制御により変更できません。" +
        "これは記録の改ざん防止を目的とした本サービスの中核的な仕様です。",
      "投稿用ファイルの1日あたりのアップロード容量には上限（10MB）を設けています。",
      "お問い合わせフォームに入力された氏名・メールアドレス・電話番号・お問い合わせ内容は、" +
        "お問い合わせへの対応の目的に限り、運営者のメールアドレスへ送信・保存されます。",
    ],
  },
  {
    title: "第4条（禁止事項）",
    body: [
      "利用者は、本サービスの利用にあたり、法令または公序良俗に違反する行為、他の利用者に属する研究室・データへの" +
        "不正アクセス、本サービスの運営を妨げる行為を行ってはならないものとします。",
    ],
  },
  {
    title: "第5条（料金）",
    body: [
      "AI査読は、無料枠を超えた分について1回ごとの従量課金となります。詳細な単価は料金ページに表示された内容によります。" +
        "決済はStripeを通じて処理され、カード情報は本サービス側で保持しません。",
    ],
  },
  {
    title: "第6条（免責事項）",
    body: [
      "本サービスが生成するAIによる査読コメント・画像・要約・類似論文の検索結果は、参考情報であり、" +
        "その正確性・完全性を保証するものではありません。研究上の最終的な判断は利用者自身の責任で行ってください。",
      "AI査読における想定Impact Factor・推奨ジャーナル・採択可能性（％）は、AIによる目安であり、" +
        "実際の査読結果・採否を保証するものではありません。",
    ],
  },
  {
    title: "第7条（規約の変更）",
    body: [
      "本サービスは、必要と判断した場合、利用者への事前通知のうえ本規約を変更できるものとします。" +
        "変更後の規約は、本ページに掲載した時点から効力を生じます。",
    ],
  },
];

/**
 * A minimal, public terms page - linked from the footer on every public
 * page. Deliberately generic boilerplate scoped to what this app actually
 * does (data ownership, the append/lock behaviour, AI-review billing); not a
 * substitute for review by counsel before a real launch.
 */
export default async function TermsPage() {
  const ctx = await getSessionContext();
  const signedIn = Boolean(ctx);

  return (
    <div className="flex min-h-dvh flex-col bg-surface-0 [--text-primary:#000] [--text-secondary:#000] [--text-muted:#000]">
      <SiteHeader signedIn={signedIn} />

      <main className="mx-auto w-full max-w-[760px] flex-1 px-5 py-16 sm:px-8">
        <h1 className="font-serif text-3xl font-semibold text-ink">利用規約</h1>
        <p className="mt-3 text-[14px] text-ink-3">最終改定日: 2026年8月25日</p>

        <div className="mt-10 flex flex-col gap-8">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h2 className="text-[17px] font-semibold text-ink">{s.title}</h2>
              <div className="mt-2 flex flex-col gap-2">
                {s.body.map((p, i) => (
                  <p key={i} className="text-[15px] leading-relaxed text-ink-2">
                    {p}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
