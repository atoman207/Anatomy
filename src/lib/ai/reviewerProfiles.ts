/**
 * Names and avatars for the three AI reviewers.
 *
 * Not `server-only`: the peer-review page needs the avatar generator in the
 * browser, and both the admin editor and the AI route need the same default
 * names and rubric-note shape. Only the read/write of `reviewer_profiles`
 * itself needs the database, and that lives in
 * `src/lib/peerReview/reviewerProfileActions.ts`.
 */

import type { ReviewerRole } from "./peerReviewReport";

export interface ReviewerProfile {
  role: ReviewerRole;
  name: string;
  /** Free text appended to that reviewer's system prompt. Empty by default. */
  rubricNotes: string;
}

/** Seeded by supabase/migrations/all.sql; used again here as the fallback before that migration has run. */
export const DEFAULT_REVIEWER_NAMES: Record<ReviewerRole, string> = {
  methods: "高橋 誠",
  novelty: "藤井 彩",
  structure: "中村 学",
};

export function defaultReviewerProfiles(): Record<ReviewerRole, ReviewerProfile> {
  return {
    methods: { role: "methods", name: DEFAULT_REVIEWER_NAMES.methods, rubricNotes: "" },
    novelty: { role: "novelty", name: DEFAULT_REVIEWER_NAMES.novelty, rubricNotes: "" },
    structure: { role: "structure", name: DEFAULT_REVIEWER_NAMES.structure, rubricNotes: "" },
  };
}

/**
 * A deterministic avatar for a reviewer, generated from its name rather than
 * stored - renaming a reviewer changes its avatar automatically, and there is
 * never an image file to host, license, or moderate. No photograph of a real
 * person is used anywhere in this app; every avatar here is a generated
 * pattern, the same idea as the default avatars GitHub or Slack assign a new
 * account before it uploads one of its own.
 */
export interface AvatarSpec {
  /** Background fill. */
  bg: string;
  /** Glyph color. */
  fg: string;
  /** The character shown - the first character of the family name. */
  glyph: string;
  /** 0-359, rotates the background pattern so same-palette avatars still read as distinct. */
  patternRotation: number;
}

/**
 * A small, warm palette rather than fully random hue - avoids the muddy or
 * illegible combinations a naive random-HSL generator produces, the same
 * reasoning `dataviz`-style categorical palettes are curated rather than
 * generated on the fly.
 */
const PALETTE: { bg: string; fg: string }[] = [
  { bg: "#B44B3E", fg: "#FBF3EE" }, // 朱 (vermilion)
  { bg: "#2F6E5C", fg: "#F1F7F4" }, // 青磁 (celadon)
  { bg: "#2C4A6E", fg: "#EEF3F9" }, // 藍 (indigo)
  { bg: "#8A5A2E", fg: "#FBF4EC" }, // 檜皮 (bark brown)
  { bg: "#6B4C7A", fg: "#F5F0F7" }, // 菫 (violet)
  { bg: "#4E6B3A", fg: "#F2F6EE" }, // 若竹 (young bamboo)
];

/** Simple string hash (djb2), deterministic across server and browser. */
function hash(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function avatarFor(name: string): AvatarSpec {
  const trimmed = name.trim();
  const glyph = [...trimmed.replace(/\s+/g, "")][0] ?? "?";
  const h = hash(trimmed || "?");
  const palette = PALETTE[h % PALETTE.length];
  return {
    bg: palette.bg,
    fg: palette.fg,
    glyph,
    patternRotation: h % 360,
  };
}
