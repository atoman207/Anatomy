import {
  VISEMES,
  VISEME_COUNT,
  VOWEL_FORMANTS,
  bandCentroid,
  bandEnergy,
  smoothstep,
  type Viseme,
  type VisemeFrame,
} from "./lipSync";

const V = Object.fromEntries(VISEMES.map((v, i) => [v, i])) as Record<Viseme, number>;

export interface LiveLipSync {
  sample(out: VisemeFrame): VisemeFrame;
  isSpeaking(): boolean;
  time(): number;
}

/**
 * Mouth shapes from audio *as it plays* (the realtime assistant's voice
 * stream), read from an AnalyserNode once per animation frame.
 *
 * Same acoustic cues as the offline `analyzeSpeechAudio` - loudness opens the
 * mouth, rough formants pick the vowel shape, hiss reads as "s" - but with
 * gentler, time-based smoothing: lips that snap to every syllable are what
 * make an avatar look synthetic, so shapes ease in (~60ms) and out (~140ms)
 * and the opening is kept modest.
 */
export function createAnalyserLipSync(
  analyser: AnalyserNode,
  speaking: () => boolean,
  startedAt: () => number,
): LiveLipSync {
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.25;
  const freq = new Float32Array(analyser.frequencyBinCount);
  const wave = new Float32Array(analyser.fftSize);
  const power = new Float32Array(analyser.frequencyBinCount);
  const binHz = analyser.context.sampleRate / analyser.fftSize;

  const current = new Float32Array(VISEME_COUNT);
  current[V.sil] = 1;
  const raw = new Float32Array(VISEME_COUNT);
  const vw = new Float32Array(VOWEL_FORMANTS.length);
  let peak = 0.05;
  let energy = 0;
  let last = performance.now();

  return {
    isSpeaking: speaking,
    time: () => {
      const s = startedAt();
      return s > 0 ? performance.now() / 1000 - s : -1;
    },
    sample(out) {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      analyser.getFloatTimeDomainData(wave);
      let sq = 0;
      for (let i = 0; i < wave.length; i++) sq += wave[i] * wave[i];
      const rms = Math.sqrt(sq / wave.length);
      // Adaptive loudness reference: fast to rise, slow (~4s) to fall.
      peak = Math.max(rms, peak * Math.exp(-dt / 4), 0.02);
      const loud = Math.min(1, rms / peak);

      raw.fill(0);
      const open = smoothstep(0.12, 0.8, loud) * 0.85;
      if (open > 0.001) {
        analyser.getFloatFrequencyData(freq);
        for (let i = 0; i < freq.length; i++) power[i] = Math.pow(10, freq[i] / 10);
        const f1 = bandCentroid(power, binHz, 250, 1100);
        const f2 = bandCentroid(power, binHz, 900, 3200);
        const voiced = bandEnergy(power, binHz, 80, 3500);
        const hiss = bandEnergy(power, binHz, 4000, Math.min(9000, analyser.context.sampleRate / 2 - binHz));
        const sib = smoothstep(0.3, 0.65, hiss / (voiced + hiss + 1e-12)) * (1 - smoothstep(0.5, 0.9, loud));
        raw[V.SS] = sib * open;

        // Plain loops: this runs every animation frame, so no closures.
        let total = 0;
        for (let i = 0; i < VOWEL_FORMANTS.length; i++) {
          const d1 = Math.log(f1 / VOWEL_FORMANTS[i][1]) / 0.3;
          const d2 = Math.log(f2 / VOWEL_FORMANTS[i][2]) / 0.25;
          vw[i] = Math.exp(-0.5 * (d1 * d1 + d2 * d2));
          total += vw[i];
        }
        const vowelMass = open * (1 - sib);
        for (let i = 0; i < VOWEL_FORMANTS.length; i++) {
          const v = VOWEL_FORMANTS[i][0];
          raw[V[v]] = total > 1e-6 ? (vw[i] / total) * vowelMass : v === "aa" ? vowelMass : 0;
        }
      }
      let used = 0;
      for (let v = 1; v < VISEME_COUNT; v++) used += raw[v];
      raw[V.sil] = Math.max(0, 1 - used);

      const kIn = 1 - Math.exp(-dt / 0.06);
      const kOut = 1 - Math.exp(-dt / 0.14);
      for (let v = 0; v < VISEME_COUNT; v++) {
        current[v] += (raw[v] - current[v]) * (raw[v] > current[v] ? kIn : kOut);
        out.weights[v] = current[v];
      }
      energy += (loud - energy) * (1 - Math.exp(-dt / 0.2));
      out.energy = energy;
      return out;
    },
  };
}
