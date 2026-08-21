/**
 * Unit conversion for the calculator tool.
 *
 * Everything converts through one base unit per quantity (grams, liters,
 * molar) so adding a unit later means adding one factor, not one function
 * per pair of units.
 */

export const MASS_UNITS = ["ng", "µg", "mg", "g", "kg"] as const;
export type MassUnit = (typeof MASS_UNITS)[number];
const MASS_TO_G: Record<MassUnit, number> = {
  ng: 1e-9, "µg": 1e-6, mg: 1e-3, g: 1, kg: 1e3,
};

export const VOLUME_UNITS = ["µL", "mL", "L"] as const;
export type VolumeUnit = (typeof VOLUME_UNITS)[number];
const VOLUME_TO_L: Record<VolumeUnit, number> = {
  "µL": 1e-6, mL: 1e-3, L: 1,
};

export const CONC_UNITS = ["pM", "nM", "µM", "mM", "M"] as const;
export type ConcUnit = (typeof CONC_UNITS)[number];
const CONC_TO_M: Record<ConcUnit, number> = {
  pM: 1e-12, nM: 1e-9, "µM": 1e-6, mM: 1e-3, M: 1,
};

export const MOLES_UNITS = ["pmol", "nmol", "µmol", "mmol", "mol"] as const;
export type MolesUnit = (typeof MOLES_UNITS)[number];
const MOLES_TO_MOL: Record<MolesUnit, number> = {
  pmol: 1e-12, nmol: 1e-9, "µmol": 1e-6, mmol: 1e-3, mol: 1,
};

export function massToGrams(value: number, unit: MassUnit): number {
  return value * MASS_TO_G[unit];
}
export function gramsToUnit(grams: number, unit: MassUnit): number {
  return grams / MASS_TO_G[unit];
}
export function volumeToLiters(value: number, unit: VolumeUnit): number {
  return value * VOLUME_TO_L[unit];
}
export function litersToUnit(liters: number, unit: VolumeUnit): number {
  return liters / VOLUME_TO_L[unit];
}
export function concToMolar(value: number, unit: ConcUnit): number {
  return value * CONC_TO_M[unit];
}
export function molarToUnit(molar: number, unit: ConcUnit): number {
  return molar / CONC_TO_M[unit];
}
export function molesToMol(value: number, unit: MolesUnit): number {
  return value * MOLES_TO_MOL[unit];
}
export function molToUnit(mol: number, unit: MolesUnit): number {
  return mol / MOLES_TO_MOL[unit];
}

/** Picks a display unit so the number reads with 1-4 significant digits. */
export function autoMassUnit(grams: number): MassUnit {
  const abs = Math.abs(grams);
  if (abs === 0) return "mg";
  if (abs < 1e-6) return "ng";
  if (abs < 1e-3) return "µg";
  if (abs < 1) return "mg";
  if (abs < 1e3) return "g";
  return "kg";
}
export function autoConcUnit(molar: number): ConcUnit {
  const abs = Math.abs(molar);
  if (abs === 0) return "mM";
  if (abs < 1e-9) return "pM";
  if (abs < 1e-6) return "nM";
  if (abs < 1e-3) return "µM";
  if (abs < 1) return "mM";
  return "M";
}
export function autoVolumeUnit(liters: number): VolumeUnit {
  const abs = Math.abs(liters);
  if (abs === 0) return "mL";
  if (abs < 1e-3) return "µL";
  if (abs < 1) return "mL";
  return "L";
}
export function autoMolesUnit(mol: number): MolesUnit {
  const abs = Math.abs(mol);
  if (abs === 0) return "µmol";
  if (abs < 1e-9) return "pmol";
  if (abs < 1e-6) return "nmol";
  if (abs < 1e-3) return "µmol";
  return "mmol";
}

/** Formats a number for display without scientific notation for common ranges. */
export function formatNumber(v: number, maxDigits = 4): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs < 1e-6 || abs >= 1e9) return v.toExponential(maxDigits - 1);
  const digits = Math.max(0, maxDigits - Math.floor(Math.log10(abs)) - 1);
  return v.toFixed(Math.min(6, Math.max(0, digits)));
}
