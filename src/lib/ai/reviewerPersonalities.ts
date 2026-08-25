/**
 * Optional per-reviewer "personality" - how a reviewer's tone and emphasis
 * read, layered on top of its fixed role (methods/novelty/structure) and
 * the selected tier (top/standard). Not `server-only`: the picker UI needs
 * the catalogue in the browser, and `peerReview.ts` needs the same list
 * server-side to build the prompt.
 *
 * Deliberately never changes what a reviewer is allowed to conclude - the
 * grounding rules and category scores stay exactly what they already are.
 * This only shapes phrasing and emphasis (how bluntly a concern is put, how
 * much benefit of the doubt is given), the same way real reviewers on a
 * panel differ in temperament without differing in what counts as evidence.
 */

export type PersonalityId =
  | "strict" | "constructive" | "concise" | "skeptical" | "meticulous" | "encouraging";

export interface ReviewerPersonality {
  id: PersonalityId;
  label: string;
  description: string;
  /** Appended to the reviewer's system prompt. */
  promptInstruction: string;
}

export const REVIEWER_PERSONALITIES: ReviewerPersonality[] = [
  {
    id: "strict",
    label: "厳格型",
    description: "些細な問題も見逃さず、妥協なく指摘します。",
    promptInstruction:
      "口調: 妥協のない厳格な査読者として書いてください。些細な問題であっても見過ごさず指摘し、" +
      "曖昧な表現には根拠の明記を強く求めてください。ただし根拠のない酷評はせず、指摘は必ず本文中の具体的な箇所に基づかせてください。",
  },
  {
    id: "constructive",
    label: "建設的型",
    description: "問題点を指摘しつつ、改善への具体的な道筋を重視します。",
    promptInstruction:
      "口調: 建設的な査読者として書いてください。問題点は明確に指摘しつつ、summaryとrecommendationsでは" +
      "著者がすぐに着手できる前向きな改善の道筋を特に丁寧に示してください。",
  },
  {
    id: "concise",
    label: "簡潔型",
    description: "要点だけを簡潔に指摘します。",
    promptInstruction:
      "口調: 簡潔な査読者として書いてください。summary・各指摘・recommendationsはいずれも冗長な前置きを避け、" +
      "要点のみを短く言い切ってください。",
  },
  {
    id: "skeptical",
    label: "懐疑的型",
    description: "主張の根拠を強く疑い、追加の証拠を求めます。",
    promptInstruction:
      "口調: 懐疑的な査読者として書いてください。著者の主張や結論を額面通りに受け取らず、" +
      "本文中の記述が本当にその結論を支持しているかを一つ一つ検証する姿勢で指摘してください。",
  },
  {
    id: "meticulous",
    label: "丁寧型",
    description: "細部まで踏み込んで詳細に検討します。",
    promptInstruction:
      "口調: 細部にまで踏み込む丁寧な査読者として書いてください。summaryや各指摘は、該当箇所の具体的な" +
      "記述内容に言及しながら、なぜそれが問題（または良い点）なのかを詳しく説明してください。",
  },
  {
    id: "encouraging",
    label: "温和型",
    description: "研究の意義を認めつつ、前向きな言葉で伝えます。",
    promptInstruction:
      "口調: 温和で励ましのある査読者として書いてください。研究の意義や工夫を積極的に評価したうえで、" +
      "問題点は否定的になりすぎない前向きな言葉で伝えてください。ただし評価の甘さで重大な問題を見逃さないこと。",
  },
];

export function personalityById(id: string | null | undefined): ReviewerPersonality | null {
  return REVIEWER_PERSONALITIES.find((p) => p.id === id) ?? null;
}

/** Picks distinct personalities for methods/novelty/structure - falls back to allowing repeats if the catalogue ever shrinks below 3. */
export function randomPersonalities<Role extends string>(roles: readonly Role[]): Record<Role, PersonalityId> {
  const pool = [...REVIEWER_PERSONALITIES];
  const result = {} as Record<Role, PersonalityId>;
  for (const role of roles) {
    const pickable = pool.length > 0 ? pool : REVIEWER_PERSONALITIES;
    const idx = Math.floor(Math.random() * pickable.length);
    result[role] = pickable[idx].id;
    if (pool.length > 0) pool.splice(pool.indexOf(pickable[idx]), 1);
  }
  return result;
}
