/**
 * Submission files: Figure / Table / Video / Article.
 *
 * Most journals require these to be uploaded as separate files at submission
 * time rather than embedded in the manuscript text - customer feedback asked
 * for exactly that separation, kept apart from the notebook's inline images.
 * Shared (not server-only) because both the upload UI and the server actions
 * need the same kind list, labels, and quota constant.
 */

export const SUBMISSION_FILE_KINDS = ["figure", "table", "video", "article"] as const;
export type SubmissionFileKind = (typeof SUBMISSION_FILE_KINDS)[number];

export const SUBMISSION_FILE_LABELS: Record<SubmissionFileKind, { title: string; description: string }> = {
  figure: { title: "Figure（図）", description: "論文本文に掲載する図版。" },
  table: { title: "Table（表）", description: "論文本文に掲載する表。" },
  video: { title: "Video（動画）", description: "補足動画（Supplementary Video）。" },
  article: { title: "Article（原稿）", description: "本文原稿・関連文書。" },
};

export function isSubmissionFileKind(v: unknown): v is SubmissionFileKind {
  return typeof v === "string" && (SUBMISSION_FILE_KINDS as readonly string[]).includes(v);
}

/**
 * Proposed cap: 10MB of combined Figure/Table/Video/Article uploads per
 * account, per JST calendar day - a deliberately small ceiling (10MB is
 * already generous for figures/tables/short manuscripts; it mainly bounds
 * video) so a single account can't run up storage costs, while still being
 * enough for normal day-to-day use across several small files.
 */
export const MAX_DAILY_SUBMISSION_UPLOAD_BYTES = 10 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
