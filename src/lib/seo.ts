/**
 * Shared SEO constants - metadataBase, sitemap, robots, and the JSON-LD on
 * the landing page all need to agree on the same canonical domain and brand
 * strings.
 *
 * Deliberately separate from `NEXT_PUBLIC_SITE_URL` (see src/lib/billing/
 * stripe.ts's siteOrigin()): that variable drives Stripe checkout return
 * URLs and auth email redirects, so changing it is a real deployment action
 * with financial/auth consequences, not something to bundle into an SEO
 * pass. SITE_URL below is the intended canonical domain for search/social
 * metadata regardless of what NEXT_PUBLIC_SITE_URL is currently set to.
 */

export const SITE_URL = "https://labnote.site";
export const SITE_NAME = "LABNOTE.";
export const SITE_TAGLINE = "研究室のための記録・解析プラットフォーム";
export const SITE_DESCRIPTION =
  "実験選択・試薬管理・音声入力・論文検索を一つの記録ウィザードにまとめ、完了と同時にPDFレポートを自動作成。" +
  "統計解析・AI画像生成・3名のAI査読者による投稿前レビューまで、研究室の記録と解析をひとつにまとめるプラットフォームです。";
export const SITE_KEYWORDS = [
  "実験ノート", "電子実験ノート", "研究データ管理", "ラボノート", "LabNote",
  "AI査読", "統計解析", "論文検索", "研究室 管理", "実験記録アプリ",
];
