/**
 * In-house question matcher for the assistant's answer cache.
 *
 * Decides whether a new question means the same thing as one already
 * answered, without calling any model: zero tokens, sub-millisecond per
 * question, deterministic and testable.
 *
 * 1. Normalize Japanese surface variation that does not change meaning:
 *    width (NFKC), katakana/hiragana, product-name spellings, synonyms
 *    (値段/価格/費用 -> 料金), fillers (えーと, すみません) and polite or
 *    question endings (教えてください, できますか -> できる).
 * 2. Represent the normalized question as character bi/tri-grams weighted by
 *    TF-IDF over the cached questions (rare n-grams like 査読 count more than
 *    common ones like です).
 * 3. Cosine similarity; a hit needs a high score, and short questions (where
 *    one n-gram changes the meaning) need an even higher one.
 */

// With the key-term guard below rejecting narrower/different questions,
// paraphrases (>=0.65 in calibration) can hit while unrelated ones (<=0.53) miss.
export const HIT_THRESHOLD = 0.6;
export const SHORT_HIT_THRESHOLD = 0.8;
const SHORT_LENGTH = 8;

/* ------------------------------------------------------------------------ */
/* Normalization                                                             */
/* ------------------------------------------------------------------------ */

function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** Private-use character standing for the product name. */
const PRODUCT = "\uE000";

/** [pattern, replacement], applied in order after kana/width folding. */
const SYNONYMS: [RegExp, string][] = [
  // One opaque token: later particle rules (とは, って) cannot eat into the
  // name, and a 7-letter name does not dominate the n-gram vector.
  [/labnote|らぼのーと|らぼ・のーと|らぼの一と/g, PRODUCT],
  [/えーあい|ａｉ/g, "ai"],
  [/ぴあれびゅー|査読ai|ai査読/g, "ai査読"],
  [/値段|価格|費用|お値段|金額|おかね|お金|いくら(かかる|ですか|ですか|なの)?/g, "料金"],
  [/さいんあっぷ|会員登録|あかうんと(の|を)?(作成|作る|つくる|登録)|新規登録/g, "登録"],
  [/さいんいん|ろぐいん/g, "ろぐいん"],
  // "How do I …" in its many forms -> 方法.
  [/(どうやって|どのように|どうすれば|どうしたら|どうやったら)(使う|使え|使い|使|する|すれ|やる|やれ)?(ば)?(いい|よい|良い)?/g, "方法"],
  [/使いかた|つかいかた|使い方|使用方法|利用方法|やり方|やりかた|手順/g, "方法"],
  [/するには|するに/g, ""],
  [/どんなこと|どういうこと|どのようなこと|どういったこと|どんな事|どういった事|どんな|どういう|どのような/g, "何"],
  [/何が|なにが|何を|なにを|何の|なにの|なに|なん/g, "何"],
  [/出来る|できます|出来ます|できるの|できますでしょう/g, "できる"],
  [/あります|あるの/g, "ある"],
  [/使えます|使えるの/g, "使える"],
  [/残せます|残せるの/g, "残せる"],
  // Topic/contrast particles that do not change what is being asked.
  [/では/g, "で"],
  [/には/g, "に"],
  [/とは|って/g, ""],
];

/** は・を・が between content words vary freely in questions (記録を残す / 記録は残す). */
const CASE_PARTICLES = /(?<=[\p{Script=Han}\p{Script=Latin}0-9ー])[はをが](?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Latin}0-9])/gu;

/** 実験の記録 / 実験記録, 登録の方法 / 登録方法. */
const NO_BETWEEN_KANJI = /(?<=\p{Script=Han})の(?=\p{Script=Han})/gu;

const LEADING_FILLERS = /^(えーと|えっと|えー|あのー|あの|すみません|すいません|ちょっと|ねえ|では|じゃあ|ところで)+/;
const TRAILING_POLITE =
  /(を)?(教えて|おしえて)(ください|下さい|もらえますか|くれますか)?$|(について)?(知りたい|しりたい)(です)?$|(んですか|んでしょうか|んです|んだ|でしょうか|ですか|ますか|ですかね|かな|か|の|ね|よ|です)+$/;

export function normalizeQuestion(raw: string): string {
  let s = toHiragana(raw.normalize("NFKC").toLowerCase());
  // Punctuation and spacing carry no meaning for matching.
  s = s.replace(/[\s\p{P}\p{S}]/gu, "");
  for (const [pattern, replacement] of SYNONYMS) s = s.replace(pattern, replacement);
  s = s.replace(CASE_PARTICLES, "");
  s = s.replace(NO_BETWEEN_KANJI, "");
  // 「LABNOTEで/は/の…」 all ask about the product itself.
  s = s.replace(/\uE000(で|は|が|を|に|の)/gu, PRODUCT);
  s = s.replace(LEADING_FILLERS, "");
  // Endings can stack (…できますか → できる + か); strip until stable.
  for (let i = 0; i < 3; i++) {
    const next = s.replace(TRAILING_POLITE, "");
    if (next === s || next.length < 2) break;
    s = next;
  }
  return s;
}

/* ------------------------------------------------------------------------ */
/* What must never be served from (or stored in) the shared cache            */
/* ------------------------------------------------------------------------ */

export type SkipReason = "empty" | "too-long" | "context" | "personal" | "time" | "identifier";

/**
 * Questions whose right answer depends on something other than the words
 * themselves: the previous turn ("それはいくら？"), the asker ("私の研究室"),
 * the date, or identifiers. Those always go to the model and are never cached,
 * so one visitor's context can never leak into another visitor's answer.
 */
export function skipReason(raw: string): SkipReason | null {
  const text = raw.normalize("NFKC").trim();
  const normalized = normalizeQuestion(text);
  if (normalized.length < 2) return "empty";
  if (text.length > 150) return "too-long";
  if (/^(それ|これ|あれ|その|この|あの|そこ|ここ|そっち|さっき|先ほど|今の|前の|上の|同じ|もう一度|もっと|続き|他に|ほかに)/.test(text) ||
      /(さっき|先ほど|今言った|前に言った|それって|その件)/.test(text)) {
    return "context";
  }
  if (/(私|わたし|僕|ぼく|俺|おれ|自分|うち|弊社|当社|うちの研究室)(の|は|が|に|で)/.test(text)) return "personal";
  if (/(今日|明日|昨日|今週|来週|先週|今月|来月|先月|今年|最新|現在|さっき|いま何時)/.test(text)) return "time";
  if (/https?:|@|\d{4,}|[a-z0-9._%+-]+\.[a-z]{2,}/i.test(text)) return "identifier";
  return null;
}

/* ------------------------------------------------------------------------ */
/* TF-IDF n-gram index                                                       */
/* ------------------------------------------------------------------------ */

function ngrams(normalized: string): Map<string, number> {
  const chars = [...normalized];
  const out = new Map<string, number>();
  const add = (g: string) => out.set(g, (out.get(g) ?? 0) + 1);
  if (chars.length === 1) add(chars[0]);
  for (let i = 0; i < chars.length - 1; i++) add(chars[i] + chars[i + 1]);
  for (let i = 0; i < chars.length - 2; i++) add(chars[i] + chars[i + 1] + chars[i + 2]);
  return out;
}

/** Maximal runs of kanji or of latin letters/digits: the content words of a question. */
function keyTerms(normalized: string): string[] {
  return normalized.match(/[\p{Script=Han}]{2,}|[a-z0-9]{2,}/gu) ?? [];
}

/** Every key term of `a` appears in `b` (or contains one of b's terms, e.g. 音声 / 音声入力). */
function termsCovered(a: string[], b: string[], bText: string): boolean {
  return a.every((t) => bText.includes(t) || b.some((u) => u.includes(t) || t.includes(u)));
}

export interface MatchCandidate {
  id: string;
  normalized: string;
}

export interface MatchResult<T extends MatchCandidate> {
  entry: T;
  score: number;
}

export class QuestionIndex<T extends MatchCandidate> {
  private readonly vectors: { entry: T; weights: Map<string, number>; norm: number }[];
  private readonly df = new Map<string, number>();
  private readonly byNormalized = new Map<string, T>();
  private readonly docCount: number;

  /**
   * @param background Extra texts (e.g. knowledge-base sentences) counted only
   *   for n-gram rarity. Without them, IDF - and so every score - would drift
   *   with how many answers happen to be cached, making a fresh cache match
   *   differently from a full one.
   */
  constructor(entries: T[], background: string[] = []) {
    const grams = entries.map((e) => ngrams(e.normalized));
    const backgroundGrams = background.map((t) => ngrams(normalizeQuestion(t)));
    this.docCount = entries.length + backgroundGrams.length;
    for (const g of [...grams, ...backgroundGrams]) {
      for (const key of g.keys()) this.df.set(key, (this.df.get(key) ?? 0) + 1);
    }
    this.vectors = entries.map((entry, i) => {
      const weights = this.weigh(grams[i]);
      return { entry, weights, norm: Math.hypot(...weights.values()) };
    });
    for (const e of entries) if (!this.byNormalized.has(e.normalized)) this.byNormalized.set(e.normalized, e);
  }

  get size() {
    return this.vectors.length;
  }

  private idf(gram: string) {
    return Math.log((this.docCount + 1) / ((this.df.get(gram) ?? 0) + 1)) + 1;
  }

  private weigh(grams: Map<string, number>) {
    const out = new Map<string, number>();
    for (const [g, tf] of grams) out.set(g, (1 + Math.log(tf)) * this.idf(g));
    return out;
  }

  /**
   * Best match for an already-normalized question, or null below threshold.
   * `minScore` overrides the length-dependent default thresholds.
   */
  match(normalized: string, minScore?: number): MatchResult<T> | null {
    if (!normalized) return null;
    const exact = this.byNormalized.get(normalized);
    if (exact) return { entry: exact, score: 1 };

    const q = this.weigh(ngrams(normalized));
    const qNorm = Math.hypot(...q.values());
    if (qNorm === 0) return null;

    let best: MatchResult<T> | null = null;
    const qLen = [...normalized].length;
    for (const v of this.vectors) {
      const len = [...v.entry.normalized].length;
      // Very different lengths are different questions, however many n-grams overlap.
      if (len > qLen * 3 || qLen > len * 3) continue;
      let dot = 0;
      for (const [g, w] of q) {
        const other = v.weights.get(g);
        if (other) dot += w * other;
      }
      const score = dot / (qNorm * v.norm || 1);
      if (best && score <= best.score) continue;
      // A narrower or different subject ("AI査読の料金" vs "料金", "PDF" vs "CSV")
      // is a different question however much of the wording overlaps.
      const qTerms = keyTerms(normalized);
      const eTerms = keyTerms(v.entry.normalized);
      if (!termsCovered(qTerms, eTerms, v.entry.normalized) || !termsCovered(eTerms, qTerms, normalized)) continue;
      best = { entry: v.entry, score };
    }
    if (!best) return null;
    const threshold =
      minScore ??
      (Math.min(qLen, [...best.entry.normalized].length) <= SHORT_LENGTH ? SHORT_HIT_THRESHOLD : HIT_THRESHOLD);
    return best.score >= threshold ? best : null;
  }
}
