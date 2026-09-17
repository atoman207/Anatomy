import { PLAN_LIST } from "@/lib/billing/plans";
import {
  FREE_PEER_REVIEW_CREDITS,
  PEER_REVIEW_CREDIT_PACKS,
} from "@/lib/peerReview/creditPacks";
import { AI_GESTURES, EMOTIONS } from "@/lib/avatar/protocol";

/**
 * The assistant's LABNOTE knowledge base and retrieval (RAG).
 *
 * Built-in documents mirror `/help`, the sidebar navigation and the billing
 * catalogues (prices are read live from those catalogues, so they cannot
 * drift). Extra documents can be added without a deploy in the Supabase table
 * `assistant_knowledge_documents` - see `assistantKnowledgeStore.ts`.
 *
 * Retrieval is character-bigram scoring: Japanese has no spaces, so word
 * tokenisation would need a morphological analyser, while bigrams match
 * 「査読」「料金」「音声入力」 reliably with zero dependencies and zero API cost.
 */

export const KNOWLEDGE_CATEGORIES = [
  "overview",
  "pricing",
  "plans",
  "features",
  "experiment-recording",
  "voice-input",
  "ai-peer-review",
  "registration",
  "security",
  "faq",
  "contact",
] as const;
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export interface KnowledgeDocument {
  id: string;
  category: KnowledgeCategory | string;
  title: string;
  body: string;
  /** Extra search terms (synonyms, English names) that are not in the body. */
  keywords?: string[];
}

function yen(n: number): string {
  return `${n.toLocaleString("ja-JP")}円`;
}

function planLines(): string {
  return PLAN_LIST.map((p) => {
    const price =
      p.amountJpy === 0
        ? "無料"
        : [
            `${yen(p.amountJpy)}/${p.billingInterval === "year" ? "年" : "月"}`,
            p.alternateAmountJpy
              ? `${yen(p.alternateAmountJpy)}/${p.alternateBillingInterval === "year" ? "年" : "月"}`
              : null,
          ]
            .filter(Boolean)
            .join(" または ");
    const ai = p.limits.aiEnabled ? "AI機能あり" : "AI機能なし";
    return `${p.name}（${price}）: ${p.tagline} ${ai}。`;
  }).join("\n");
}

function peerReviewPriceLine(): string {
  const packs = PEER_REVIEW_CREDIT_PACKS.map((p) =>
    p.billingInterval === "month" ? `${p.name} ${yen(p.amountJpy)}/月` : `${p.name} ${yen(p.amountJpy)}`,
  ).join("、");
  return `最初の${FREE_PEER_REVIEW_CREDITS}回は無料、以降は ${packs}。`;
}

export function builtinKnowledge(): KnowledgeDocument[] {
  return [
    {
      id: "overview",
      category: "overview",
      title: "LABNOTEとは",
      body:
        "LABNOTE（ラボノート）は、話すだけで実験記録を残し、データ整理・統計解析・論文検索・AI査読までを一つにつなぐ研究支援プラットフォームです。" +
        "対象は大学院生、ポスドク・個人研究者、企業研究者、大学研究室・PI、大学・研究機関です。" +
        "電子実験ノートにとどまらず、記録から論文投稿までをつなぐ研究ワークフロー基盤です。",
      keywords: ["何ができる", "サービス", "できること", "概要", "特徴", "違い", "ELN"],
    },
    {
      id: "navigation",
      category: "features",
      title: "画面と場所（サイドバー）",
      body:
        "ダッシュボード（/dashboard）は今日のラボレポートと実験ごとの過去記録。研究室（/labs）は作成とメンバー招待。" +
        "チャット（/chat）は研究室メンバー同士の公開・非公開チャンネル、ダイレクトメッセージ、音声・映像通話。" +
        "記録ウィザード（/record）は5ステップの実験記録。データ整理（/organize）、統計・図（/analyze）、AI査読（/peer-review）、" +
        "計算ツール（/calculator）、料金・支払い（/billing）、アカウント設定（/account）、管理画面（/admin、研究室管理者向け）。" +
        "公開ページはトップ（/）、ヘルプ（/help）、お問い合わせ（/contact）、利用規約（/terms）、ログイン（/login）、新規登録（/register）です。",
      keywords: ["どこ", "場所", "メニュー", "ページ", "開き方", "ナビ"],
    },
    {
      id: "pricing",
      category: "pricing",
      title: "料金プラン",
      body:
        `${planLines()}\n` +
        "AI機能（音声文字起こし・構造化・論文要約・画像生成）は個人研究者プラン以上で利用できます。" +
        "年払いは月払いより割安です。実際の請求額は決済画面（Stripe）の表示が優先されます。プランは「料金・支払い」（/billing）から選べます。",
      keywords: ["料金", "価格", "値段", "いくら", "プラン", "月額", "年額", "無料", "有料", "支払い", "課金"],
    },
    {
      id: "plans-limits",
      category: "plans",
      title: "プランの上限",
      body:
        PLAN_LIST.map((p) => {
          const l = p.limits;
          const n = (v: number | null, unit: string) => (v === null ? "無制限" : `${v}${unit}`);
          return `${p.name}: 研究室${n(l.maxLabs, "つ")}、メンバー${n(l.maxMembers, "名")}、実験${n(l.maxExperiments, "件")}。`;
        }).join("") + "上限に達した場合は上位プランへの変更で枠が増えます。",
      keywords: ["上限", "制限", "何人", "何件", "メンバー数", "実験数"],
    },
    {
      id: "record-wizard",
      category: "experiment-recording",
      title: "記録ウィザード（実験記録）",
      body:
        "「実験選択」「試薬・Lot」「テンプレート」「実験ノート」「論文検索」の5ステップを順番に進むと、その日のラボレポートが1件のPDFとして完成します。" +
        "各ステップの先頭には選んだ研究室・実験・試薬・テンプレートが表示され、前のステップに戻って直しても後の入力は消えません。" +
        "ヘッダーの「今日の実験記録」ボタンからも開始できます。完了と同時にPDFレポートが自動保存され、ダッシュボードに並びます。",
      keywords: ["記録", "ウィザード", "PDF", "レポート", "5ステップ", "使い方"],
    },
    {
      id: "templates",
      category: "experiment-recording",
      title: "テンプレート",
      body:
        "汎用実験ノートのほか、ウェスタンブロット・RT-qPCR・ELISA・フローサイトメトリーなど研究分野ごとの組み込みテンプレートがあります。" +
        "研究室独自のカスタムテンプレートを実験ノート画面から作成・編集でき、管理者は管理画面のテンプレートから研究室共通のひな形を用意できます。",
      keywords: ["テンプレ", "ひな形", "ウェスタン", "qPCR", "ELISA", "フロー"],
    },
    {
      id: "voice-input",
      category: "voice-input",
      title: "音声入力",
      body:
        "実験ノートのステップでは、マイクに話しかけて記録できます。既定は日本語で、英語（en-US）にも切り替えられます。" +
        "マイクは何度でも押し直せて、書き起こしは追記されます。無料のブラウザ音声認識と、より高精度な有料エンジンがあります。" +
        "書き起こしをAIが「手順」「結果」などの項目に振り分けた下書きにします。AIは入力されていない実験条件を推測で埋めず「未記録」として扱います。",
      keywords: ["音声", "音声で入力", "マイク", "話す", "文字起こし", "書き起こし", "構造化", "ディクテーション"],
    },
    {
      id: "images-files",
      category: "features",
      title: "AI画像生成と投稿用ファイル",
      body:
        "ノート内容とプロンプトから、細胞・分子経路・実験フローなどの模式図をAIが生成しレポートに挿入できます。画像のアップロードや、統計・図で作ったグラフの挿入もできます。" +
        "投稿用ファイル欄ではFigure・Table・Video・Articleを登録でき、同じ実験の記録で共有されます（1日あたり10MBまで）。",
      keywords: ["画像", "図", "模式図", "Figure", "Table", "動画", "アップロード"],
    },
    {
      id: "data-analysis",
      category: "features",
      title: "データ整理・統計解析・論文検索",
      body:
        "データ整理（/organize）では測定ファイルの整理、ファイル命名、サンプルシートを扱います。統計・図（/analyze）では統計解析と論文用図版を作成でき、計算はブラウザ内で実行されます。" +
        "論文検索では、AIが検索式を作り、PubMedとCrossrefから実在する文献を取得します。AIが文献そのものを創作することはありません。AI論文要約もあります。",
      keywords: ["統計", "解析", "グラフ", "検定", "論文検索", "PubMed", "文献", "要約"],
    },
    {
      id: "peer-review",
      category: "ai-peer-review",
      title: "AI査読の仕組み",
      body:
        "方法・統計、研究内容・新規性、論文構成・論理を専門に見る3名のAI査読者が、それぞれ独立に論文を評価します。" +
        "評価水準はトップジャーナル基準か一般的な国際誌基準を選べ、査読者ごとの性格（厳格型・建設的型・簡潔型・懐疑的型・丁寧型・温和型）も指定できます。" +
        "再査読では以前の査読と比べて総合評価・カテゴリ別評価の改善をグラフで確認できます。投稿先ジャーナル名から想定IFレンジ・推奨ジャーナル・採択可能性の目安を表示し、投稿要項URLから形式チェックもできます。" +
        `いずれもAIによる目安で、採否を保証しません。料金は ${peerReviewPriceLine()}`,
      keywords: ["査読", "レビュー", "論文評価", "投稿前", "ジャーナル", "採択", "再査読", "クレジット"],
    },
    {
      id: "registration",
      category: "registration",
      title: "登録とはじめ方",
      body:
        "新規登録（/register）はメールアドレスとパスワードで行い、表示名やアバター画像なども設定できます。無料プランから始められます。" +
        "パスワードを忘れた場合はログイン画面から再設定リンクを受け取れます。" +
        "登録後は研究室を作成するか招待を受けて参加し、記録ウィザードで最初の実験を記録してPDFを保存します。AI機能が必要になったら「料金・支払い」でプランを選びます。",
      keywords: ["登録", "サインアップ", "アカウント作成", "ログイン", "パスワード", "はじめ方", "始める"],
    },
    {
      id: "members",
      category: "features",
      title: "研究室とメンバー管理",
      body:
        "研究室ページからメンバーを招待できます。既存アカウントはすぐ追加され、未登録のメールアドレスは相手が登録した時点で自動的に参加します。" +
        "役割はオーナー・管理者・メンバー・閲覧者で、書き込みや招待の権限が変わります。",
      keywords: ["招待", "メンバー", "権限", "ロール", "共有", "研究室"],
    },
    {
      id: "security",
      category: "security",
      title: "記録の信頼性とセキュリティ",
      body:
        "データは研究室単位で管理され、役割ごとにアクセスが制御されます。確定済みの音声ノートは変更できず、実験ノートは作成当日のみ修正できます。" +
        "誰が・いつ・何をしたかは追記型の監査ログに残り、ログ自体は編集・削除できません。統計処理と作図はブラウザ内で実行されます。" +
        "一方で、音声の高精度文字起こし、構造化、論文要約、AI査読などの機能では、その機能に必要な情報が外部のAIサービスに送信されます。",
      keywords: ["セキュリティ", "安全", "改ざん", "監査", "ログ", "個人情報", "外部送信", "プライバシー", "データ"],
    },
    {
      id: "faq-ai-trust",
      category: "faq",
      title: "よくある質問：AIの出力について",
      body:
        "AIは研究者の確認を支援する道具です。実験条件、統計結果、引用、査読結果の最終確認は研究者が行ってください。" +
        "AI査読は投稿前の弱点を観点別に確認するためのもので、採択を保証するものではありません。",
      keywords: ["信頼", "正確", "AI", "保証", "間違い"],
    },
    {
      id: "contact",
      category: "contact",
      title: "お問い合わせ",
      body:
        "機能の質問、導入の相談、不具合の報告、ご意見・ご要望はお問い合わせページ（/contact）のフォームから送れます。" +
        "大学・研究機関など組織での導入相談も同じページで受け付けています。使い方の詳細はヘルプ（/help）にまとまっています。",
      keywords: ["問い合わせ", "連絡", "相談", "サポート", "不具合", "バグ", "導入", "ヘルプ"],
    },
  ];
}

/* ------------------------------------------------------------------------ */
/* Retrieval                                                                 */
/* ------------------------------------------------------------------------ */

function normalizeText(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[\s、。，．・「」『』（）()：:！!？?]/g, "");
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  const chars = [...normalizeText(s)];
  for (let i = 0; i < chars.length - 1; i++) {
    const g = chars[i] + chars[i + 1];
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

export interface RetrievedDocument {
  doc: KnowledgeDocument;
  score: number;
}

/**
 * Top documents for a question. Keyword and title hits weigh more than body
 * hits, and common bigrams are down-weighted by document frequency.
 */
export function retrieveKnowledge(
  query: string,
  docs: KnowledgeDocument[],
  limit = 4,
): RetrievedDocument[] {
  const q = bigrams(query);
  if (q.size === 0 || docs.length === 0) return [];

  const indexed = docs.map((doc) => ({
    doc,
    length: [...doc.body].length,
    body: bigrams(doc.body),
    head: bigrams(`${doc.title} ${(doc.keywords ?? []).join(" ")}`),
  }));
  const df = new Map<string, number>();
  for (const d of indexed) {
    for (const g of new Set([...d.body.keys(), ...d.head.keys()])) df.set(g, (df.get(g) ?? 0) + 1);
  }

  const avgLength = indexed.reduce((a, d) => a + d.length, 0) / indexed.length || 1;
  const scored = indexed.map(({ doc, body, head, length }) => {
    let score = 0;
    // BM25-style length normalisation: long documents mention everything once.
    const lengthNorm = 0.25 + 0.75 * (length / avgLength);
    for (const [g] of q) {
      const idf = Math.log(1 + docs.length / (df.get(g) ?? docs.length));
      if (head.has(g)) score += 3 * idf;
      const tf = body.get(g) ?? 0;
      if (tf) score += ((tf * 2.2) / (tf + 1.2 * lengthNorm)) * idf;
    }
    return { doc, score: score / Math.sqrt(q.size) };
  });

  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/* ------------------------------------------------------------------------ */
/* Prompt                                                                    */
/* ------------------------------------------------------------------------ */

const PERSONA = `あなたは LABNOTE の研究アシスタントです。白衣を着た20代の日本人女性研究者として、ビデオ通話の相手と向き合って話します。

## 話し方
- 標準語（共通語）の、丁寧で自然な です・ます調。方言やくだけすぎた言い回しは使いません。
- 返答はそのまま音声で読み上げられ、3Dアバターが話します。見出し・箇条書き記号・表・絵文字・URLの羅列・Markdown記法は使わず、耳で聞いて分かる短い文で話してください。
- 全体で2〜5文、長くても200字程度。手順は「まず」「次に」「最後に」でつなぎます。
- 英字の略語は読みやすくします（例: LABNOTE は「ラボノート」、PDF は「ピーディーエフ」）。
- 画面の場所を案内するときは「サイドバーの〇〇」「ヘッダーの〇〇ボタン」のように伝えます。

## 表情と身ぶり（segments）
返答は segments に1〜2文ずつ分け、各文に emotion・gesture・intensity を付けます。
- emotion: ${EMOTIONS.join(" / ")}
- gesture: ${AI_GESTURES.join(" / ")}
- 自然な人間らしさのため、多くの文は gesture を "none" か小さな動き（SmallNod, HeadTilt, Smile, BrowRaise）にします。
- 手の動き（ExplainLeft, ExplainRight, ExplainBoth, Point, Count, OpenPalms, HandOnChest, Greeting, Bow, ThankYou）は、あいさつ・お礼・大事なポイント・項目の列挙など、話の内容が本当に必要とする文だけに使い、1回の返答で多くても1〜2回にします。
- intensity は普段 0.2〜0.5。強い感情や重要な強調のときだけ 0.6 以上にします。
- 例: お礼には emotion "grateful" と gesture "ThankYou" または "SmallNod"。機能の説明の要点には "confident" と "ExplainBoth"。質問を返すときは "curious" と "HeadTilt"。

## 守ること
- LABNOTE の使い方・料金・機能については、下の「参考情報」だけを根拠に答えます。書かれていないことは推測で断定せず、ヘルプページかお問い合わせを案内します。
- 研究一般の質問（実験手法・統計・論文執筆など）にも答えてよいですが、推測は推測だと明記します。
- 危険な実験手順、医療・診断の判断には踏み込まず、専門家や所属機関への確認を促します。
- ユーザーの研究データや研究室の中身、カメラ映像は見えていません。見えているふりをしないでください。`;

export type AssistantMode = "voice" | "video";

export function assistantSystemPrompt(
  mode: AssistantMode,
  viewer: { signedIn: boolean; aiPlan: boolean },
  retrieved: KnowledgeDocument[] = builtinKnowledge(),
): string {
  const modeNote =
    mode === "video"
      ? "このセッションはビデオ通話形式です。"
      : "このセッションは音声チャットです。";
  const viewerNote = !viewer.signedIn
    ? "相手はまだログインしていない訪問者です。LABNOTE の紹介や始め方を案内するときは、無料登録やログインを自然に勧めてください。"
    : viewer.aiPlan
      ? "相手はログイン済みで、AI機能が使えるプランの研究室に所属しています。"
      : "相手はログイン済みですが、AI機能が使えるプランではない可能性があります。必要に応じて「料金・支払い」を案内してください。";

  const reference = retrieved
    .map((d) => `### ${d.title}\n${d.body}`)
    .join("\n\n");

  return `${PERSONA}\n\n## 今回の状況\n${modeNote}\n${viewerNote}\n\n## 参考情報（LABNOTE ナレッジベースから検索）\n${reference}`;
}

/** Delivery instructions for the neural text-to-speech voice. */
export const ASSISTANT_VOICE_INSTRUCTIONS =
  "話者: 20代の日本人女性。東京の標準語（共通語）アクセントで、NHKアナウンサーのように正確で明瞭な発音。" +
  "トーン: 明るく親しみやすいが落ち着いていて、丁寧。語尾を伸ばしたり、甘えた話し方や作った声にはしない。" +
  "テンポ: 自然でややゆっくり。句読点で短い間を取り、文末は自然に下げる。" +
  "英字の略語や製品名は日本語話者として自然なカタカナ読みにする（LABNOTE は「ラボノート」）。" +
  "Voice: a fluent native Japanese woman in her twenties speaking standard Tokyo Japanese (hyōjungo) " +
  "with accurate pitch accent, clear articulation, warm and friendly but composed, no regional dialect and no foreign accent.";
