/**
 * Mouth-shape (viseme) tracks for the talking assistant avatar.
 *
 * Two sources, one output shape:
 *
 * - `analyzeSpeechAudio` reads the decoded TTS waveform. Mouth opening follows
 *   loudness, vowel shape follows rough first/second formant estimates, and
 *   short silences inside speech become lip closures. Because the track is
 *   built from the same buffer that is played, it stays in sync for the whole
 *   reply instead of drifting.
 * - `textVisemeTrack` is the fallback for browser `speechSynthesis`, whose
 *   audio the page cannot hear. It schedules kana vowels at a typical Japanese
 *   speaking rate, and the caller re-anchors it on `boundary` events.
 */

export const VISEMES = ["sil", "PP", "FF", "SS", "aa", "E", "I", "O", "U"] as const;
export type Viseme = (typeof VISEMES)[number];
export const VISEME_COUNT = VISEMES.length;

const V = Object.fromEntries(VISEMES.map((v, i) => [v, i])) as Record<Viseme, number>;

export interface VisemeFrame {
  /** Weight per entry of `VISEMES`, 0..1. */
  weights: Float32Array;
  /** Speech loudness 0..1, used for head motion and brow emphasis. */
  energy: number;
}

export interface VisemeTrack {
  fps: number;
  duration: number;
  /** `frameCount * VISEME_COUNT` weights, row per frame. */
  weights: Float32Array;
  energy: Float32Array;
}

export function emptyFrame(): VisemeFrame {
  const weights = new Float32Array(VISEME_COUNT);
  weights[V.sil] = 1;
  return { weights, energy: 0 };
}

/**
 * Samples a track at `time` seconds into `out`, interpolating between frames.
 * Past the end (or before the start) the mouth rests closed.
 */
export function sampleTrack(track: VisemeTrack, time: number, out: VisemeFrame): VisemeFrame {
  const frames = track.energy.length;
  const f = time * track.fps;
  if (!(f >= 0) || f >= frames - 1) {
    out.weights.fill(0);
    out.weights[V.sil] = 1;
    out.energy = 0;
    return out;
  }
  const i = Math.floor(f);
  const k = f - i;
  const a = i * VISEME_COUNT;
  const b = a + VISEME_COUNT;
  for (let v = 0; v < VISEME_COUNT; v++) {
    out.weights[v] = track.weights[a + v] * (1 - k) + track.weights[b + v] * k;
  }
  out.energy = track.energy[i] * (1 - k) + track.energy[i + 1] * k;
  return out;
}

/* ------------------------------------------------------------------------ */
/* Audio analysis                                                            */
/* ------------------------------------------------------------------------ */

const FPS = 60;
const WINDOW = 2048;

/** In-place iterative radix-2 FFT. */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j];
        const ui = im[i + j];
        const xr = re[i + j + len / 2];
        const xi = im[i + j + len / 2];
        const vr = xr * cr - xi * ci;
        const vi = xr * ci + xi * cr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr;
        im[i + j + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/**
 * Approximate formants (Hz) of Japanese vowels for an adult female voice.
 * Japanese /u/ is unrounded and fronted, hence its fairly high F2.
 */
export const VOWEL_FORMANTS: [Viseme, number, number][] = [
  ["aa", 850, 1450],
  ["I", 330, 2750],
  ["U", 380, 1650],
  ["E", 560, 2350],
  ["O", 520, 1000],
];

export function bandCentroid(power: Float32Array, binHz: number, lo: number, hi: number) {
  const a = Math.max(1, Math.floor(lo / binHz));
  const b = Math.min(power.length - 1, Math.ceil(hi / binHz));
  let sum = 0;
  let weighted = 0;
  for (let i = a; i <= b; i++) {
    // Squaring again sharpens the centroid toward the formant peak.
    const p = power[i] * power[i];
    sum += p;
    weighted += p * i * binHz;
  }
  return sum > 0 ? weighted / sum : (lo + hi) / 2;
}

export function bandEnergy(power: Float32Array, binHz: number, lo: number, hi: number) {
  const a = Math.max(1, Math.floor(lo / binHz));
  const b = Math.min(power.length - 1, Math.ceil(hi / binHz));
  let sum = 0;
  for (let i = a; i <= b; i++) sum += power[i];
  return sum;
}

export function smoothstep(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Minimal slice of `AudioBuffer`, so tests can pass plain arrays. */
export interface PcmSource {
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

export function analyzeSpeechAudio(buffer: PcmSource): VisemeTrack {
  const { sampleRate, length } = buffer;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
    buffer.getChannelData(c),
  );
  const hop = sampleRate / FPS;
  const frames = Math.max(2, Math.ceil(length / hop) + 1);
  const binHz = sampleRate / WINDOW;

  const hann = new Float32Array(WINDOW);
  for (let i = 0; i < WINDOW; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WINDOW - 1));

  const re = new Float32Array(WINDOW);
  const im = new Float32Array(WINDOW);
  const power = new Float32Array(WINDOW / 2);

  const rms = new Float32Array(frames);
  const f1 = new Float32Array(frames);
  const f2 = new Float32Array(frames);
  const sibilance = new Float32Array(frames);

  // Loudness uses a short window: the long FFT window would smear the brief
  // silences of lip closures away.
  const rmsHalf = Math.max(1, Math.round(sampleRate * 0.0125));

  for (let f = 0; f < frames; f++) {
    const center = Math.round(f * hop);
    const start = center - WINDOW / 2;
    let sq = 0;
    for (let i = 0; i < WINDOW; i++) {
      const idx = start + i;
      let s = 0;
      if (idx >= 0 && idx < length) {
        for (const ch of channels) s += ch[idx];
        s /= channels.length;
      }
      if (Math.abs(idx - center) < rmsHalf) sq += s * s;
      re[i] = s * hann[i];
      im[i] = 0;
    }
    rms[f] = Math.sqrt(sq / (2 * rmsHalf));
    fft(re, im);
    for (let i = 0; i < WINDOW / 2; i++) power[i] = re[i] * re[i] + im[i] * im[i];

    f1[f] = bandCentroid(power, binHz, 250, 1100);
    f2[f] = bandCentroid(power, binHz, 900, 3200);
    const voiced = bandEnergy(power, binHz, 80, 3500);
    const hiss = bandEnergy(power, binHz, 4000, Math.min(9000, sampleRate / 2 - binHz));
    sibilance[f] = hiss / (voiced + hiss + 1e-12);
  }

  // Normalize loudness against the reply's own loud passages so quiet and
  // loud TTS voices open the mouth equally wide.
  const sorted = Float32Array.from(rms).sort();
  const ref = Math.max(1e-4, sorted[Math.floor(sorted.length * 0.95)]);
  const loud = new Float32Array(frames);
  for (let f = 0; f < frames; f++) loud[f] = Math.min(1, rms[f] / ref);

  // Short dips between voiced frames read as lip closures (ぱ, ま, っ...).
  const voicedMask = Array.from(loud, (l) => l > 0.12);
  const closure = new Float32Array(frames);
  for (let f = 0; f < frames; ) {
    if (voicedMask[f]) {
      f++;
      continue;
    }
    let end = f;
    while (end < frames && !voicedMask[end]) end++;
    const gap = end - f;
    if (f > 0 && end < frames && gap >= 2 && gap <= 7) {
      for (let g = f; g < end; g++) closure[g] = 1;
    }
    f = end;
  }

  const weights = new Float32Array(frames * VISEME_COUNT);
  const energy = new Float32Array(frames);
  const raw = new Float32Array(VISEME_COUNT);
  const prev = new Float32Array(VISEME_COUNT);
  prev[V.sil] = 1;

  for (let f = 0; f < frames; f++) {
    raw.fill(0);
    const open = smoothstep(0.06, 0.7, loud[f]);

    if (closure[f]) {
      raw[V.PP] = 1;
    } else if (open > 0) {
      const sib = smoothstep(0.25, 0.6, sibilance[f]) * (1 - smoothstep(0.5, 0.9, loud[f]));
      raw[V.SS] = sib * open;

      let total = 0;
      const vw = new Float32Array(VOWEL_FORMANTS.length);
      VOWEL_FORMANTS.forEach(([, p1, p2], i) => {
        const d1 = Math.log(f1[f] / p1) / 0.28;
        const d2 = Math.log(f2[f] / p2) / 0.22;
        vw[i] = Math.exp(-0.5 * (d1 * d1 + d2 * d2));
        total += vw[i];
      });
      const vowelMass = open * (1 - sib);
      VOWEL_FORMANTS.forEach(([v], i) => {
        raw[V[v]] = total > 1e-6 ? (vw[i] / total) * vowelMass : v === "aa" ? vowelMass : 0;
      });
    }
    let used = 0;
    for (let v = 1; v < VISEME_COUNT; v++) used += raw[v];
    raw[V.sil] = Math.max(0, 1 - used);

    // Fast attack, slower release: lips move to a shape quickly but do not
    // snap shut between syllables, which reads as mechanical flapping.
    const row = f * VISEME_COUNT;
    for (let v = 0; v < VISEME_COUNT; v++) {
      const k = raw[v] > prev[v] ? 0.65 : 0.35;
      prev[v] += (raw[v] - prev[v]) * k;
      weights[row + v] = prev[v];
    }
    energy[f] = loud[f];
  }

  return { fps: FPS, duration: length / sampleRate, weights, energy };
}

/* ------------------------------------------------------------------------ */
/* Text-driven fallback                                                      */
/* ------------------------------------------------------------------------ */

// Vowel per kana from U+3041 (ぁ) to U+3094 (ゔ); katakana is the same +0x60.
// "P" marks the small っ closure, "N" the moraic ん.
const KANA_VOWELS = "aaiiuueeooaaiiuueeooaaiiuueeooaaiiPuueeooaiueoaaaiiiuuueeeoooaiueoaauuooaiueoaaieoNu";
const KANA_CLOSED_ROWS = new Set(["ば", "ぱ", "ま", "び", "ぴ", "み", "ぶ", "ぷ", "む", "べ", "ぺ", "め", "ぼ", "ぽ", "も"]);
const VOWEL_VISEME: Record<string, Viseme> = { a: "aa", i: "I", u: "U", e: "E", o: "O" };

/** Seconds per mora at `rate` 1 — conversational Japanese runs ~7–8 morae/s. */
const MORA_SECONDS = 0.135;

interface Mora {
  viseme: Viseme;
  /** Lips press together at the start (ま/ば/ぱ rows). */
  closedOnset: boolean;
  duration: number;
  charIndex: number;
}

function textMorae(text: string, rate: number): Mora[] {
  const out: Mora[] = [];
  let last: Viseme = "aa";
  const beat = MORA_SECONDS / rate;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = ch.charCodeAt(0);
    const hira = code >= 0x30a1 && code <= 0x30f4 ? String.fromCharCode(code - 0x60) : ch;
    const hc = hira.charCodeAt(0);

    if (hc >= 0x3041 && hc <= 0x3094) {
      const small = "ぁぃぅぇぉゃゅょゎ".includes(hira);
      const v = KANA_VOWELS[hc - 0x3041];
      if (v === "P") {
        out.push({ viseme: "PP", closedOnset: false, duration: beat, charIndex: i });
      } else if (v === "N") {
        out.push({ viseme: "U", closedOnset: false, duration: beat * 0.8, charIndex: i });
      } else if (small && out.length) {
        // Glides (きゃ) replace the previous vowel rather than adding a mora.
        out[out.length - 1].viseme = VOWEL_VISEME[v];
      } else {
        last = VOWEL_VISEME[v];
        out.push({ viseme: last, closedOnset: KANA_CLOSED_ROWS.has(hira), duration: beat, charIndex: i });
      }
    } else if (ch === "ー") {
      out.push({ viseme: last, closedOnset: false, duration: beat, charIndex: i });
    } else if (/[、，,]/.test(ch)) {
      out.push({ viseme: "sil", closedOnset: false, duration: 0.22 / rate, charIndex: i });
    } else if (/[。．.！!？?\n]/.test(ch)) {
      out.push({ viseme: "sil", closedOnset: false, duration: 0.42 / rate, charIndex: i });
    } else if (/[一-鿿㐀-䶿]/.test(ch)) {
      // Kanji readings are unknown without a dictionary; two morae with a
      // deterministic vowel keeps the rhythm plausible.
      for (let m = 0; m < 2; m++) {
        last = VOWEL_VISEME["aiueo"[(code + m * 3) % 5]];
        out.push({ viseme: last, closedOnset: (code + m) % 7 === 0, duration: beat, charIndex: i });
      }
    } else if (/[aiueo]/i.test(ch)) {
      last = VOWEL_VISEME[ch.toLowerCase()];
      out.push({ viseme: last, closedOnset: false, duration: beat * 0.7, charIndex: i });
    } else if (/[bmp]/i.test(ch)) {
      out.push({ viseme: "PP", closedOnset: false, duration: beat * 0.35, charIndex: i });
    } else if (/[fv]/i.test(ch)) {
      out.push({ viseme: "FF", closedOnset: false, duration: beat * 0.35, charIndex: i });
    } else if (/[sz]/i.test(ch)) {
      out.push({ viseme: "SS", closedOnset: false, duration: beat * 0.35, charIndex: i });
    } else if (/[0-9a-z]/i.test(ch)) {
      out.push({ viseme: "E", closedOnset: false, duration: beat * 0.4, charIndex: i });
    } else if (/\s/.test(ch)) {
      out.push({ viseme: "sil", closedOnset: false, duration: 0.08 / rate, charIndex: i });
    }
  }
  return out;
}

export interface TextVisemeTrack extends VisemeTrack {
  /** Estimated start time (s) of each character, for boundary re-anchoring. */
  charTimes: Float32Array;
}

export function textVisemeTrack(text: string, rate = 1): TextVisemeTrack {
  const morae = textMorae(text, rate);
  const duration = morae.reduce((s, m) => s + m.duration, 0) + 0.2;
  const frames = Math.max(2, Math.ceil(duration * FPS) + 1);
  const weights = new Float32Array(frames * VISEME_COUNT);
  const energy = new Float32Array(frames);
  const charTimes = new Float32Array(text.length + 1);

  let t = 0;
  let mi = 0;
  let charCursor = 0;
  for (const m of morae) {
    for (; charCursor <= m.charIndex; charCursor++) charTimes[charCursor] = t;
    const a = Math.floor(t * FPS);
    const b = Math.min(frames, Math.ceil((t + m.duration) * FPS));
    const speaking = m.viseme !== "sil";
    // Slight per-mora variation so repeated vowels do not look stamped.
    const amp = speaking ? 0.75 + 0.25 * Math.abs(Math.sin(mi * 2.7)) : 0;
    for (let f = a; f < b; f++) {
      const p = (f - a) / Math.max(1, b - a);
      const row = f * VISEME_COUNT;
      if (!speaking) {
        weights[row + V.sil] = 1;
        continue;
      }
      if (m.closedOnset && p < 0.3) {
        weights[row + V.PP] = 1;
        continue;
      }
      const env = Math.sin(Math.PI * Math.min(1, p * 1.15)) * amp;
      weights[row + V[m.viseme]] = m.viseme === "PP" ? 1 : env;
      weights[row + V.sil] = m.viseme === "PP" ? 0 : 1 - env;
      energy[f] = speaking && m.viseme !== "PP" ? env : 0;
    }
    t += m.duration;
    mi++;
  }
  for (; charCursor <= text.length; charCursor++) charTimes[charCursor] = t;

  // Same attack/release smoothing as the audio path.
  const prev = new Float32Array(VISEME_COUNT);
  prev[V.sil] = 1;
  for (let f = 0; f < frames; f++) {
    const row = f * VISEME_COUNT;
    let any = 0;
    for (let v = 0; v < VISEME_COUNT; v++) any += weights[row + v];
    if (any === 0) weights[row + V.sil] = 1;
    for (let v = 0; v < VISEME_COUNT; v++) {
      const target = weights[row + v];
      const k = target > prev[v] ? 0.55 : 0.3;
      prev[v] += (target - prev[v]) * k;
      weights[row + v] = prev[v];
    }
  }

  return { fps: FPS, duration, weights, energy, charTimes };
}
