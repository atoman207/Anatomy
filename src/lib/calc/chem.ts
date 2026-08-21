/**
 * Deterministic lab-math helpers: molarity, dilution, molecular weight.
 *
 * Intentionally has nothing to do with the AI layer. A concentration is
 * either arithmetically correct or it is not, and a model has no business
 * being in the loop for that - see chondro's stats modules for the same
 * argument applied to statistics.
 */

export interface MolarityInputs {
  /** Mass of solute, in grams. */
  massG?: number;
  /** Molecular weight, in g/mol. */
  mwGPerMol?: number;
  /** Solution volume, in liters. */
  volumeL?: number;
  /** Molar concentration, in mol/L. */
  concentrationM?: number;
}

export type MolaritySolved = "massG" | "mwGPerMol" | "volumeL" | "concentrationM";

/**
 * Solves c = (mass / MW) / volume for whichever one of the four values is
 * missing, given the other three. Returns null if zero or more than one is
 * missing, or if a provided value cannot yield a valid answer (e.g. MW = 0).
 */
export function solveMolarity(
  inputs: MolarityInputs,
): { solved: MolaritySolved; value: number } | null {
  const keys: MolaritySolved[] = ["massG", "mwGPerMol", "volumeL", "concentrationM"];
  const missing = keys.filter((k) => inputs[k] === undefined || Number.isNaN(inputs[k]));
  if (missing.length !== 1) return null;
  const { massG, mwGPerMol, volumeL, concentrationM } = inputs;

  const solved = missing[0];
  if (solved === "concentrationM") {
    if (!mwGPerMol || !volumeL) return null;
    return { solved, value: massG! / mwGPerMol / volumeL };
  }
  if (solved === "massG") {
    if (!concentrationM || !mwGPerMol || !volumeL) return null;
    return { solved, value: concentrationM * volumeL * mwGPerMol };
  }
  if (solved === "volumeL") {
    if (!concentrationM || !mwGPerMol) return null;
    if (concentrationM === 0) return null;
    return { solved, value: massG! / mwGPerMol / concentrationM };
  }
  // solved === "mwGPerMol"
  if (!concentrationM || !volumeL || concentrationM * volumeL === 0) return null;
  return { solved, value: massG! / (concentrationM * volumeL) };
}

export interface DilutionInputs {
  c1?: number;
  v1?: number;
  c2?: number;
  v2?: number;
}
export type DilutionSolved = "c1" | "v1" | "c2" | "v2";

/** Solves C1V1 = C2V2 for whichever one of the four is missing. */
export function solveDilution(
  inputs: DilutionInputs,
): { solved: DilutionSolved; value: number } | null {
  const keys: DilutionSolved[] = ["c1", "v1", "c2", "v2"];
  const missing = keys.filter((k) => inputs[k] === undefined || Number.isNaN(inputs[k]));
  if (missing.length !== 1) return null;
  const { c1, v1, c2, v2 } = inputs;
  const solved = missing[0];
  if (solved === "c1") {
    if (!v1) return null;
    return { solved, value: (c2! * v2!) / v1 };
  }
  if (solved === "v1") {
    if (!c1) return null;
    return { solved, value: (c2! * v2!) / c1 };
  }
  if (solved === "c2") {
    if (!v2) return null;
    return { solved, value: (c1! * v1!) / v2 };
  }
  // solved === "v2"
  if (!c2) return null;
  return { solved, value: (c1! * v1!) / c2 };
}

/** mass (g) = moles (mol) x molecular weight (g/mol). */
export function massFromMoles(molesMol: number, mwGPerMol: number): number {
  return molesMol * mwGPerMol;
}
/** moles (mol) = mass (g) / molecular weight (g/mol). */
export function molesFromMass(massG: number, mwGPerMol: number): number {
  if (mwGPerMol === 0) return NaN;
  return massG / mwGPerMol;
}
