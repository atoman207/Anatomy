"use client";

import { useMemo, useState } from "react";
import { Badge, Callout, Card, Field, Select, TextInput, cx } from "@/components/ui";
import {
  solveMolarity, solveDilution, massFromMoles, molesFromMass,
  type MolaritySolved, type DilutionSolved,
} from "@/lib/calc/chem";
import {
  MASS_UNITS, VOLUME_UNITS, CONC_UNITS, MOLES_UNITS,
  massToGrams, gramsToUnit, volumeToLiters, litersToUnit,
  concToMolar, molarToUnit, molesToMol, molToUnit,
  autoMassUnit, autoConcUnit, autoVolumeUnit, autoMolesUnit, formatNumber,
  type MassUnit, type VolumeUnit, type ConcUnit, type MolesUnit,
} from "@/lib/calc/units";

type Tab = "molarity" | "dilution" | "mw" | "units";

const TABS: { id: Tab; label: string }[] = [
  { id: "molarity", label: "モル濃度" },
  { id: "dilution", label: "希釈 (C1V1=C2V2)" },
  { id: "mw", label: "分子量 ↔ mol" },
  { id: "units", label: "単位変換" },
];

/** Parses a field left blank on purpose ("solve for this") as undefined. */
function parseOptional(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

export default function CalculatorPage() {
  const [tab, setTab] = useState<Tab>("molarity");

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold text-ink">計算ツール</h1>
        <p className="mt-1 text-sm text-ink-2">
          モル濃度、希釈、分子量、単位変換。AIを使わず、その場で正確に計算します。
        </p>
      </header>

      <div role="tablist" aria-label="計算の種類" className="scroll-x flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === t.id
                ? "border-accent text-accent"
                : "border-transparent text-ink-2 hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "molarity" && <MolarityCalc />}
      {tab === "dilution" && <DilutionCalc />}
      {tab === "mw" && <MwCalc />}
      {tab === "units" && <UnitConverter />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Molarity: c = (mass / MW) / volume                                  */
/* ------------------------------------------------------------------ */

const MOLARITY_LABEL: Record<MolaritySolved, string> = {
  massG: "質量",
  mwGPerMol: "分子量",
  volumeL: "体積",
  concentrationM: "濃度",
};

function MolarityCalc() {
  const [massValue, setMassValue] = useState("");
  const [massUnit, setMassUnit] = useState<MassUnit>("mg");
  const [mwValue, setMwValue] = useState("");
  const [volumeValue, setVolumeValue] = useState("");
  const [volumeUnit, setVolumeUnit] = useState<VolumeUnit>("mL");
  const [concValue, setConcValue] = useState("");
  const [concUnit, setConcUnit] = useState<ConcUnit>("mM");

  const blankCount = [massValue, mwValue, volumeValue, concValue].filter(
    (v) => v.trim() === "",
  ).length;

  const result = useMemo(() => {
    const massG = parseOptional(massValue);
    const mwGPerMol = parseOptional(mwValue);
    const volumeL = parseOptional(volumeValue);
    const concentrationM = parseOptional(concValue);
    return solveMolarity({
      massG: massG === undefined ? undefined : massToGrams(massG, massUnit),
      mwGPerMol,
      volumeL: volumeL === undefined ? undefined : volumeToLiters(volumeL, volumeUnit),
      concentrationM: concentrationM === undefined ? undefined : concToMolar(concentrationM, concUnit),
    });
  }, [massValue, massUnit, mwValue, volumeValue, volumeUnit, concValue, concUnit]);

  function displayResult(): string {
    if (!result) return "—";
    if (result.solved === "massG") {
      const unit = autoMassUnit(result.value);
      return `${formatNumber(gramsToUnit(result.value, unit))} ${unit}`;
    }
    if (result.solved === "volumeL") {
      const unit = autoVolumeUnit(result.value);
      return `${formatNumber(litersToUnit(result.value, unit))} ${unit}`;
    }
    if (result.solved === "concentrationM") {
      const unit = autoConcUnit(result.value);
      return `${formatNumber(molarToUnit(result.value, unit))} ${unit}`;
    }
    return `${formatNumber(result.value)} g/mol`;
  }

  return (
    <Card
      title="モル濃度: c = (質量 ÷ 分子量) ÷ 体積"
      subtitle="4項目のうち1つだけ空欄にすると、その値を計算します。"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="質量">
          <div className="flex gap-2">
            <TextInput
              type="number" inputMode="decimal" value={massValue}
              onChange={(e) => setMassValue(e.target.value)} placeholder="空欄 = 計算対象"
            />
            <Select
              className="w-24" value={massUnit}
              onChange={(e) => setMassUnit(e.target.value as MassUnit)}
            >
              {MASS_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          </div>
        </Field>

        <Field label="分子量 (MW)" hint="g/mol">
          <TextInput
            type="number" inputMode="decimal" value={mwValue}
            onChange={(e) => setMwValue(e.target.value)} placeholder="空欄 = 計算対象"
          />
        </Field>

        <Field label="体積">
          <div className="flex gap-2">
            <TextInput
              type="number" inputMode="decimal" value={volumeValue}
              onChange={(e) => setVolumeValue(e.target.value)} placeholder="空欄 = 計算対象"
            />
            <Select
              className="w-24" value={volumeUnit}
              onChange={(e) => setVolumeUnit(e.target.value as VolumeUnit)}
            >
              {VOLUME_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          </div>
        </Field>

        <Field label="濃度">
          <div className="flex gap-2">
            <TextInput
              type="number" inputMode="decimal" value={concValue}
              onChange={(e) => setConcValue(e.target.value)} placeholder="空欄 = 計算対象"
            />
            <Select
              className="w-24" value={concUnit}
              onChange={(e) => setConcUnit(e.target.value as ConcUnit)}
            >
              {CONC_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          </div>
        </Field>
      </div>

      <div className="mt-4">
        {blankCount === 0 ? (
          <Callout tone="info">1項目を空欄にしてください（計算したい値）。</Callout>
        ) : blankCount > 1 ? (
          <Callout tone="info">空欄は1つだけにしてください。残り3項目を入力すると自動計算します。</Callout>
        ) : result ? (
          <div className="rounded-lg border border-accent/30 bg-accent-soft px-4 py-3">
            <p className="text-xs font-medium text-ink-2">{MOLARITY_LABEL[result.solved]}</p>
            <p className="mt-0.5 text-2xl font-semibold tabular-nums text-ink">{displayResult()}</p>
          </div>
        ) : (
          <Callout tone="warn">この組み合わせでは計算できません（0で割る等）。値を確認してください。</Callout>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Dilution: C1V1 = C2V2                                               */
/* ------------------------------------------------------------------ */

const DILUTION_LABEL: Record<DilutionSolved, string> = {
  c1: "C1（希釈前濃度）",
  v1: "V1（希釈前体積）",
  c2: "C2（希釈後濃度）",
  v2: "V2（希釈後体積）",
};

function DilutionCalc() {
  const [c1, setC1] = useState("");
  const [c1Unit, setC1Unit] = useState<ConcUnit>("mM");
  const [v1, setV1] = useState("");
  const [v1Unit, setV1Unit] = useState<VolumeUnit>("µL");
  const [c2, setC2] = useState("");
  const [c2Unit, setC2Unit] = useState<ConcUnit>("mM");
  const [v2, setV2] = useState("");
  const [v2Unit, setV2Unit] = useState<VolumeUnit>("mL");

  const blankCount = [c1, v1, c2, v2].filter((v) => v.trim() === "").length;

  const result = useMemo(() => {
    const nc1 = parseOptional(c1);
    const nv1 = parseOptional(v1);
    const nc2 = parseOptional(c2);
    const nv2 = parseOptional(v2);
    return solveDilution({
      c1: nc1 === undefined ? undefined : concToMolar(nc1, c1Unit),
      v1: nv1 === undefined ? undefined : volumeToLiters(nv1, v1Unit),
      c2: nc2 === undefined ? undefined : concToMolar(nc2, c2Unit),
      v2: nv2 === undefined ? undefined : volumeToLiters(nv2, v2Unit),
    });
  }, [c1, c1Unit, v1, v1Unit, c2, c2Unit, v2, v2Unit]);

  function displayResult(): string {
    if (!result) return "—";
    if (result.solved === "c1" || result.solved === "c2") {
      const unit = autoConcUnit(result.value);
      return `${formatNumber(molarToUnit(result.value, unit))} ${unit}`;
    }
    const unit = autoVolumeUnit(result.value);
    return `${formatNumber(litersToUnit(result.value, unit))} ${unit}`;
  }

  return (
    <Card
      title="希釈: C1 × V1 = C2 × V2"
      subtitle="4項目のうち1つだけ空欄にすると、その値を計算します。"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="C1（希釈前濃度）">
          <div className="flex gap-2">
            <TextInput
              type="number" inputMode="decimal" value={c1}
              onChange={(e) => setC1(e.target.value)} placeholder="空欄 = 計算対象"
            />
            <Select className="w-24" value={c1Unit} onChange={(e) => setC1Unit(e.target.value as ConcUnit)}>
              {CONC_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          </div>
        </Field>
        <Field label="V1（希釈前体積）">
          <div className="flex gap-2">
            <TextInput
              type="number" inputMode="decimal" value={v1}
              onChange={(e) => setV1(e.target.value)} placeholder="空欄 = 計算対象"
            />
            <Select className="w-24" value={v1Unit} onChange={(e) => setV1Unit(e.target.value as VolumeUnit)}>
              {VOLUME_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          </div>
        </Field>
        <Field label="C2（希釈後濃度）">
          <div className="flex gap-2">
            <TextInput
              type="number" inputMode="decimal" value={c2}
              onChange={(e) => setC2(e.target.value)} placeholder="空欄 = 計算対象"
            />
            <Select className="w-24" value={c2Unit} onChange={(e) => setC2Unit(e.target.value as ConcUnit)}>
              {CONC_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          </div>
        </Field>
        <Field label="V2（希釈後体積）">
          <div className="flex gap-2">
            <TextInput
              type="number" inputMode="decimal" value={v2}
              onChange={(e) => setV2(e.target.value)} placeholder="空欄 = 計算対象"
            />
            <Select className="w-24" value={v2Unit} onChange={(e) => setV2Unit(e.target.value as VolumeUnit)}>
              {VOLUME_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          </div>
        </Field>
      </div>

      <div className="mt-4">
        {blankCount === 0 ? (
          <Callout tone="info">1項目を空欄にしてください（計算したい値）。</Callout>
        ) : blankCount > 1 ? (
          <Callout tone="info">空欄は1つだけにしてください。残り3項目を入力すると自動計算します。</Callout>
        ) : result ? (
          <div className="rounded-lg border border-accent/30 bg-accent-soft px-4 py-3">
            <p className="text-xs font-medium text-ink-2">{DILUTION_LABEL[result.solved]}</p>
            <p className="mt-0.5 text-2xl font-semibold tabular-nums text-ink">{displayResult()}</p>
          </div>
        ) : (
          <Callout tone="warn">この組み合わせでは計算できません（0で割る等）。値を確認してください。</Callout>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Molecular weight ↔ moles                                            */
/* ------------------------------------------------------------------ */

function MwCalc() {
  const [mw, setMw] = useState("");

  const [massValue, setMassValue] = useState("");
  const [massUnit, setMassUnit] = useState<MassUnit>("mg");

  const [molesValue, setMolesValue] = useState("");
  const [molesUnit, setMolesUnit] = useState<MolesUnit>("µmol");

  const mwNum = parseOptional(mw);

  const molesFromMassResult = useMemo(() => {
    const massG = parseOptional(massValue);
    if (massG === undefined || mwNum === undefined || mwNum === 0) return null;
    const mol = molesFromMass(massToGrams(massG, massUnit), mwNum);
    const unit = autoMolesUnit(mol);
    return `${formatNumber(molToUnit(mol, unit))} ${unit}`;
  }, [massValue, massUnit, mwNum]);

  const massFromMolesResult = useMemo(() => {
    const mol = parseOptional(molesValue);
    if (mol === undefined || mwNum === undefined) return null;
    const grams = massFromMoles(molesToMol(mol, molesUnit), mwNum);
    const unit = autoMassUnit(grams);
    return `${formatNumber(gramsToUnit(grams, unit))} ${unit}`;
  }, [molesValue, molesUnit, mwNum]);

  return (
    <div className="flex flex-col gap-4">
      <Card title="分子量" subtitle="下の両方の計算で共通して使います。">
        <Field label="分子量 (MW)" hint="g/mol" className="max-w-xs">
          <TextInput
            type="number" inputMode="decimal" value={mw}
            onChange={(e) => setMw(e.target.value)} placeholder=""
          />
        </Field>
      </Card>

      <Card title="質量 → 物質量 (mol)">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="質量">
            <div className="flex gap-2">
              <TextInput
                type="number" inputMode="decimal" value={massValue}
                onChange={(e) => setMassValue(e.target.value)}
              />
              <Select className="w-24" value={massUnit} onChange={(e) => setMassUnit(e.target.value as MassUnit)}>
                {MASS_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select>
            </div>
          </Field>
        </div>
        <div className="mt-3">
          {mwNum === undefined ? (
            <Callout tone="info">分子量を入力してください。</Callout>
          ) : molesFromMassResult ? (
            <div className="rounded-lg border border-accent/30 bg-accent-soft px-4 py-3">
              <p className="text-xs font-medium text-ink-2">物質量</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums text-ink">{molesFromMassResult}</p>
            </div>
          ) : (
            <Callout tone="info">質量を入力してください。</Callout>
          )}
        </div>
      </Card>

      <Card title="物質量 (mol) → 質量">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="物質量">
            <div className="flex gap-2">
              <TextInput
                type="number" inputMode="decimal" value={molesValue}
                onChange={(e) => setMolesValue(e.target.value)}
              />
              <Select className="w-24" value={molesUnit} onChange={(e) => setMolesUnit(e.target.value as MolesUnit)}>
                {MOLES_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select>
            </div>
          </Field>
        </div>
        <div className="mt-3">
          {mwNum === undefined ? (
            <Callout tone="info">分子量を入力してください。</Callout>
          ) : massFromMolesResult ? (
            <div className="rounded-lg border border-accent/30 bg-accent-soft px-4 py-3">
              <p className="text-xs font-medium text-ink-2">質量</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums text-ink">{massFromMolesResult}</p>
            </div>
          ) : (
            <Callout tone="info">物質量を入力してください。</Callout>
          )}
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Generic unit converter                                              */
/* ------------------------------------------------------------------ */

type Kind = "mass" | "volume" | "conc" | "moles";

const KIND_LABEL: Record<Kind, string> = {
  mass: "質量", volume: "体積", conc: "モル濃度", moles: "物質量",
};

function UnitConverter() {
  const [kind, setKind] = useState<Kind>("mass");
  const [value, setValue] = useState("1");
  const [unit, setUnit] = useState("mg");

  const units: readonly string[] =
    kind === "mass" ? MASS_UNITS : kind === "volume" ? VOLUME_UNITS
      : kind === "conc" ? CONC_UNITS : MOLES_UNITS;

  function toBase(v: number, u: string): number {
    if (kind === "mass") return massToGrams(v, u as MassUnit);
    if (kind === "volume") return volumeToLiters(v, u as VolumeUnit);
    if (kind === "conc") return concToMolar(v, u as ConcUnit);
    return molesToMol(v, u as MolesUnit);
  }
  function fromBase(v: number, u: string): number {
    if (kind === "mass") return gramsToUnit(v, u as MassUnit);
    if (kind === "volume") return litersToUnit(v, u as VolumeUnit);
    if (kind === "conc") return molarToUnit(v, u as ConcUnit);
    return molToUnit(v, u as MolesUnit);
  }

  const num = parseOptional(value);
  const base = num === undefined ? null : toBase(num, unit);

  return (
    <Card title="単位変換" subtitle="1つの値を入力すると、同じ種類のすべての単位で表示します。">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="種類">
          <Select
            value={kind}
            onChange={(e) => {
              const k = e.target.value as Kind;
              setKind(k);
              setUnit(
                k === "mass" ? "mg" : k === "volume" ? "mL" : k === "conc" ? "mM" : "µmol",
              );
            }}
          >
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </Select>
        </Field>
        <Field label="値">
          <div className="flex gap-2">
            <TextInput
              type="number" inputMode="decimal" value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <Select className="w-24" value={unit} onChange={(e) => setUnit(e.target.value)}>
              {units.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          </div>
        </Field>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {base === null ? (
          <Callout tone="info">値を入力してください。</Callout>
        ) : (
          units.map((u) => (
            <div
              key={u}
              className={cx(
                "flex items-center justify-between rounded-md border px-3 py-2",
                u === unit ? "border-accent bg-accent-soft" : "border-line bg-surface-2",
              )}
            >
              <Badge tone={u === unit ? "accent" : "neutral"}>{u}</Badge>
              <span className="tabular-nums text-ink">{formatNumber(fromBase(base, u))}</span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
