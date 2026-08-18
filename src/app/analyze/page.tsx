"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  Badge, Button, Callout, Card, DataTable, EmptyState, Field,
  Select, StatTile, TextInput, cx,
} from "@/components/ui";
import { useDownload, useWorkspace, type LoadedDataset } from "@/components/workspace";
import { buildDemoData } from "@/lib/data/demo";
import { parseDelimited } from "@/lib/data/csv";
import { profileTable, buildMatrix, sampleQc } from "@/lib/data/table";
import { toDelimited } from "@/lib/data/csv";
import {
  transform, normalize, impute, filterByCompleteness,
  type DataMatrix, type TransformMethod, type NormalizeMethod, type ImputeMethod,
} from "@/lib/stats/matrix";
import { StatsPanel } from "@/components/analyze/StatsPanel";
import { FiguresPanel } from "@/components/analyze/FiguresPanel";

type Tab = "import" | "stats" | "figures";

const TABS: { id: Tab; label: string; en: string }[] = [
  { id: "import", label: "取り込み", en: "Import & prep" },
  { id: "stats", label: "統計解析", en: "Statistics" },
  { id: "figures", label: "図作成", en: "Figures" },
];

export interface PrepOptions {
  transform: TransformMethod;
  normalize: NormalizeMethod;
  impute: ImputeMethod;
  minCompleteness: number;
}

const DEFAULT_PREP: PrepOptions = {
  transform: "none",
  normalize: "none",
  impute: "none",
  minCompleteness: 0,
};

export default function AnalyzePage() {
  const ws = useWorkspace();
  const [tab, setTab] = useState<Tab>("import");
  const [prep, setPrep] = useState<PrepOptions>(DEFAULT_PREP);
  const [groupOverrides, setGroupOverrides] = useState<Record<string, string>>({});

  const dataset = ws.dataset;

  /*
   * Group assignment is derived, not stored: the seed comes from the sample
   * sheet (matching on sample id or filename stem) and the user's edits are
   * kept as a thin overlay. Deriving avoids an effect that would write the
   * seed back into state and re-render on every dataset change.
   */
  const seededGroups = useMemo(() => {
    if (!dataset) return {} as Record<string, string>;
    const sheetRows = ws.sheet?.rows ?? [];
    const next: Record<string, string> = {};
    for (const s of dataset.matrix.samples) {
      const hit = sheetRows.find(
        (r) =>
          r.sample_id === s ||
          r.file_name === s ||
          r.file_name.replace(/\.[^.]+$/, "") === s,
      );
      next[s] = hit?.group ?? guessGroup(s);
    }
    return next;
  }, [dataset, ws.sheet]);

  const groups = useMemo(
    () => ({ ...seededGroups, ...groupOverrides }),
    [seededGroups, groupOverrides],
  );

  const prepared = useMemo(() => {
    if (!dataset) return null;
    let m: DataMatrix = dataset.matrix;
    const notes: string[] = [];
    if (prep.minCompleteness > 0) {
      const r = filterByCompleteness(m, prep.minCompleteness);
      m = r.matrix;
      if (r.dropped) notes.push(`${r.dropped} feature(s) dropped by the completeness filter.`);
    }
    if (prep.transform !== "none") m = transform(m, prep.transform);
    if (prep.normalize !== "none") m = normalize(m, prep.normalize);
    if (prep.impute !== "none") m = impute(m, prep.impute);
    return { matrix: m, notes };
  }, [dataset, prep]);

  const groupList = useMemo(
    () => (dataset ? dataset.matrix.samples.map((s) => groups[s] ?? "") : []),
    [dataset, groups],
  );

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold text-ink">統計解析・図作成 / Statistics &amp; figures</h1>
        <p className="mt-1 text-sm text-ink-2">
          t-test, ANOVA, PCA and clustering, with volcano, heatmap and PCA plots.
          All computation happens in your browser.
        </p>
      </header>

      <div role="tablist" className="scroll-x flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            disabled={t.id !== "import" && !dataset}
            onClick={() => setTab(t.id)}
            className={cx(
              "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              tab === t.id ? "border-accent text-accent" : "border-transparent text-ink-2 hover:text-ink",
            )}
          >
            {t.label}
            <span className="ml-1.5 text-xs text-ink-3">{t.en}</span>
          </button>
        ))}
      </div>

      {tab === "import" && (
        <ImportPanel
          prep={prep}
          setPrep={setPrep}
          groups={groups}
          setGroups={setGroupOverrides}
          prepared={prepared}
          onReady={() => setTab("stats")}
        />
      )}

      {tab === "stats" && dataset && prepared && (
        <StatsPanel matrix={prepared.matrix} groups={groupList} datasetName={dataset.name} />
      )}

      {tab === "figures" && dataset && prepared && (
        <FiguresPanel matrix={prepared.matrix} groups={groupList} datasetName={dataset.name} />
      )}
    </div>
  );
}

/** Strips a trailing replicate number to guess the condition from a name. */
function guessGroup(sample: string): string {
  const m = sample.match(/^(.*?)[_\-. ]*(\d{1,3})$/);
  return (m ? m[1] : sample).replace(/[_\-. ]+$/, "") || sample;
}

/* ------------------------------------------------------------------ */

function ImportPanel({
  prep, setPrep, groups, setGroups, prepared, onReady,
}: {
  prep: PrepOptions;
  setPrep: (p: PrepOptions) => void;
  groups: Record<string, string>;
  setGroups: (g: Record<string, string>) => void;
  prepared: { matrix: DataMatrix; notes: string[] } | null;
  onReady: () => void;
}) {
  const ws = useWorkspace();
  const download = useDownload();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ headers: string[]; rows: string[][] } | null>(null);

  const load = useCallback(
    (d: LoadedDataset, pv?: { headers: string[]; rows: string[][] }) => {
      ws.setDataset(d);
      setGroups({});
      setPreview(pv ?? null);
      setError(null);
    },
    [ws, setGroups],
  );

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) {
        // Delimited text is parsed locally so nothing leaves the browser.
        const text = await file.text();
        const parsed = parseDelimited(text);
        if (parsed.headers.length === 0) throw new Error("No header row found.");
        const profile = profileTable(parsed.headers, parsed.rows);
        const built = buildMatrix(parsed.headers, parsed.rows, profile);
        load(
          {
            name: file.name,
            sourceFilename: file.name,
            sourceSheet: null,
            matrix: built.matrix,
            profile,
            headers: parsed.headers,
            notes: [...profile.notes, ...built.notes],
          },
          { headers: parsed.headers, rows: parsed.rows.slice(0, 25) },
        );
      } else {
        // Excel needs the Node parser.
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/import", { method: "POST", body: form });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `Import failed (${res.status})`);
        load(
          {
            name: json.sheet ? `${file.name} — ${json.sheet}` : file.name,
            sourceFilename: file.name,
            sourceSheet: json.sheet ?? null,
            matrix: json.matrix,
            profile: json.profile,
            headers: json.headers,
            notes: json.notes ?? [],
          },
          { headers: json.headers, rows: json.preview ?? [] },
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  const dataset = ws.dataset;
  const qc = useMemo(
    () => (prepared ? sampleQc(prepared.matrix) : null),
    [prepared],
  );

  const groupCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of Object.values(groups)) {
      if (g.trim()) m.set(g, (m.get(g) ?? 0) + 1);
    }
    return [...m.entries()].map(([name, n]) => ({ name, n }));
  }, [groups]);

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="データ読み込み / Load data"
        subtitle="Rows are features (proteins, genes, measurements); columns are samples. CSV, TSV and XLSX are supported."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? "読み込み中… / Reading…" : "ファイル選択 / Choose file"}
          </Button>
          <Button
            onClick={() => {
              const demo = buildDemoData();
              load({
                name: demo.name,
                sourceFilename: null,
                sourceSheet: null,
                matrix: demo.matrix,
                profile: null,
                headers: ["Protein", ...demo.matrix.samples],
                notes: ["Synthetic demo data — 4 conditions in triplicate, log2 scale."],
              });
            }}
            disabled={busy}
          >
            デモデータ / Load demo data
          </Button>
          {dataset && (
            <Button variant="danger" onClick={() => { ws.setDataset(null); setPreview(null); }}>
              クリア / Clear
            </Button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xlsm"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
        </div>
        {error && <div className="mt-3"><Callout tone="danger" title="Import failed">{error}</Callout></div>}
      </Card>

      {!dataset && (
        <EmptyState title="No dataset loaded">
          Load a file or the demo data to continue.
        </EmptyState>
      )}

      {dataset && prepared && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Features" value={prepared.matrix.features.length} hint={`${dataset.matrix.features.length} imported`} />
            <StatTile label="Samples" value={prepared.matrix.samples.length} />
            <StatTile label="Groups" value={groupCounts.length} tone={groupCounts.length >= 2 ? "good" : "warn"} />
            <StatTile
              label="Missing"
              value={`${missingPct(prepared.matrix).toFixed(1)}%`}
              tone={missingPct(prepared.matrix) > 20 ? "warn" : "good"}
            />
          </div>

          {[...dataset.notes, ...prepared.notes].length > 0 && (
            <div className="flex flex-col gap-2">
              {[...dataset.notes, ...prepared.notes].map((n, i) => (
                <Callout key={i} tone="info">{n}</Callout>
              ))}
            </div>
          )}

          <Card
            title="前処理 / Preprocessing"
            subtitle="Applied in order: completeness filter → transform → normalize → impute."
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="変換 / Transform" hint="log2 is the usual choice for intensity data.">
                <Select
                  value={prep.transform}
                  onChange={(e) => setPrep({ ...prep, transform: e.target.value as TransformMethod })}
                >
                  <option value="none">None</option>
                  <option value="log2">log2</option>
                  <option value="log10">log10</option>
                  <option value="ln">ln</option>
                  <option value="sqrt">sqrt</option>
                  <option value="zscore">Row z-score</option>
                </Select>
              </Field>
              <Field label="正規化 / Normalize" hint="Removes loading differences between samples.">
                <Select
                  value={prep.normalize}
                  onChange={(e) => setPrep({ ...prep, normalize: e.target.value as NormalizeMethod })}
                >
                  <option value="none">None</option>
                  <option value="median">Median centring</option>
                  <option value="sum">Total sum</option>
                  <option value="quantile">Quantile</option>
                  <option value="vsn-lite">Median shift (log data)</option>
                </Select>
              </Field>
              <Field label="欠損値 / Impute" hint="PCA and clustering need complete rows.">
                <Select
                  value={prep.impute}
                  onChange={(e) => setPrep({ ...prep, impute: e.target.value as ImputeMethod })}
                >
                  <option value="none">Leave missing</option>
                  <option value="rowmean">Row mean</option>
                  <option value="rowmedian">Row median</option>
                  <option value="knn">k-nearest neighbours</option>
                  <option value="half-min">Half of global minimum</option>
                  <option value="min">Global minimum</option>
                  <option value="zero">Zero</option>
                </Select>
              </Field>
              <Field
                label={`完全性フィルタ / Min completeness: ${(prep.minCompleteness * 100).toFixed(0)}%`}
                hint="Drops features observed in too few samples."
              >
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={10}
                  value={prep.minCompleteness * 100}
                  onChange={(e) => setPrep({ ...prep, minCompleteness: Number(e.target.value) / 100 })}
                  className="w-full accent-[var(--accent)]"
                />
              </Field>
            </div>
          </Card>

          <Card
            title="群の割り当て / Group assignment"
            subtitle="Every comparison depends on this. Seeded from the sample sheet where names match."
            actions={
              <Button size="sm" variant="primary" onClick={onReady} disabled={groupCounts.length < 2}>
                解析へ / Go to statistics
              </Button>
            }
          >
            {groupCounts.length < 2 && (
              <div className="mb-3">
                <Callout tone="warn">
                  At least two groups with a name are needed before any comparison can run.
                </Callout>
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {prepared.matrix.samples.map((s) => (
                <div key={s} className="flex items-center gap-2">
                  <span className="w-0 flex-1 truncate font-mono text-xs text-ink-2" title={s}>{s}</span>
                  <TextInput
                    value={groups[s] ?? ""}
                    onChange={(e) => setGroups({ ...groups, [s]: e.target.value })}
                    placeholder="group"
                    className="w-32"
                    aria-label={`Group for ${s}`}
                  />
                </div>
              ))}
            </div>
            {groupCounts.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {groupCounts.map((g) => (
                  <Badge key={g.name} tone={g.n >= 3 ? "good" : g.n === 2 ? "warn" : "danger"}>
                    {g.name}: n={g.n}
                  </Badge>
                ))}
              </div>
            )}
          </Card>

          {qc && (
            <Card
              title="サンプルQC / Sample QC"
              subtitle="Compare medians across samples: a sample far off the others usually means a loading or injection problem."
              actions={
                <Button
                  size="sm"
                  onClick={() =>
                    download(
                      "sample_qc.csv",
                      toDelimited(
                        ["sample", "observed", "missing", "median", "mean", "min", "max"],
                        qc.map((q) => [q.sample, q.observed, q.missing, q.median, q.mean, q.min, q.max]),
                      ),
                      "text/csv",
                    )
                  }
                >
                  CSV
                </Button>
              }
            >
              <DataTable
                maxHeight="24rem"
                headers={["Sample", "Group", "Observed", "Missing", "Median", "Mean", "Min", "Max"]}
                align={["left", "left", "right", "right", "right", "right", "right", "right"]}
                rows={qc.map((q) => [
                  <span key="s" className="font-mono">{q.sample}</span>,
                  groups[q.sample] || "—",
                  q.observed,
                  q.missing,
                  fmt(q.median),
                  fmt(q.mean),
                  fmt(q.min),
                  fmt(q.max),
                ])}
              />
            </Card>
          )}

          {preview && preview.rows.length > 0 && (
            <Card title="元データ / Source preview" subtitle={`First ${preview.rows.length} rows as imported`}>
              <DataTable
                maxHeight="20rem"
                headers={preview.headers.slice(0, 14)}
                rows={preview.rows.map((r) => r.slice(0, 14))}
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function missingPct(m: DataMatrix): number {
  const total = m.features.length * m.samples.length;
  if (!total) return 0;
  let miss = 0;
  for (const r of m.values) for (const v of r) if (v === null || !Number.isFinite(v)) miss++;
  return (miss / total) * 100;
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v !== 0 && (Math.abs(v) < 1e-3 || Math.abs(v) >= 1e6)) return v.toExponential(2);
  return v.toFixed(2);
}
