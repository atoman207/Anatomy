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

const TABS: { id: Tab; label: string }[] = [
  { id: "import", label: "取り込み" },
  { id: "stats", label: "統計解析" },
  { id: "figures", label: "図作成" },
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
      if (r.dropped) notes.push(`完全性フィルタにより ${r.dropped} 個の特徴量を除外しました。`);
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
        <h1 className="text-xl font-semibold text-ink">統計解析・図作成</h1>
        <p className="mt-1 text-sm text-ink-2">
          t検定、ANOVA、PCA、クラスタリングに加え、ボルケーノ、ヒートマップ、PCAプロットを作成します。計算はすべてブラウザ内で行います。
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
        if (parsed.headers.length === 0) throw new Error("ヘッダー行が見つかりません。");
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
        if (!res.ok) throw new Error(json.error ?? `取り込みに失敗しました（${res.status}）`);
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
      setError(e instanceof Error ? e.message : "取り込みに失敗しました。");
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
        title="データ読み込み"
        subtitle="行は特徴量（タンパク質、遺伝子、測定値）、列はサンプルです。CSV、TSV、XLSXに対応しています。"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? "読み込み中…" : "ファイルを選択"}
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
                notes: ["合成デモデータ — 4条件×3反復、log2スケール。"],
              });
            }}
            disabled={busy}
          >
            デモデータを読み込む
          </Button>
          {dataset && (
            <Button variant="danger" onClick={() => { ws.setDataset(null); setPreview(null); }}>
              クリア
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
        {error && <div className="mt-3"><Callout tone="danger" title="取り込み失敗">{error}</Callout></div>}
      </Card>

      {!dataset && (
        <EmptyState title="データセットがありません">
          ファイルまたはデモデータを読み込んでください。
        </EmptyState>
      )}

      {dataset && prepared && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="特徴量" value={prepared.matrix.features.length} hint={`${dataset.matrix.features.length} 件を取り込み`} />
            <StatTile label="サンプル" value={prepared.matrix.samples.length} />
            <StatTile label="群" value={groupCounts.length} tone={groupCounts.length >= 2 ? "good" : "warn"} />
            <StatTile
              label="欠損"
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
            title="前処理"
            subtitle="適用順：完全性フィルタ → 変換 → 正規化 → 補完。"
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="変換" hint="強度データでは通常 log2 を選びます。">
                <Select
                  value={prep.transform}
                  onChange={(e) => setPrep({ ...prep, transform: e.target.value as TransformMethod })}
                >
                  <option value="none">なし</option>
                  <option value="log2">log2</option>
                  <option value="log10">log10</option>
                  <option value="ln">ln</option>
                  <option value="sqrt">平方根</option>
                  <option value="zscore">行のzスコア</option>
                </Select>
              </Field>
              <Field label="正規化" hint="サンプル間のローディング差を取り除きます。">
                <Select
                  value={prep.normalize}
                  onChange={(e) => setPrep({ ...prep, normalize: e.target.value as NormalizeMethod })}
                >
                  <option value="none">なし</option>
                  <option value="median">中央値センタリング</option>
                  <option value="sum">総和</option>
                  <option value="quantile">分位点</option>
                  <option value="vsn-lite">中央値シフト（対数データ）</option>
                </Select>
              </Field>
              <Field label="欠損値" hint="PCAとクラスタリングには欠損のない行が必要です。">
                <Select
                  value={prep.impute}
                  onChange={(e) => setPrep({ ...prep, impute: e.target.value as ImputeMethod })}
                >
                  <option value="none">欠損のまま</option>
                  <option value="rowmean">行の平均</option>
                  <option value="rowmedian">行の中央値</option>
                  <option value="knn">k近傍</option>
                  <option value="half-min">全体最小値の半分</option>
                  <option value="min">全体最小値</option>
                  <option value="zero">ゼロ</option>
                </Select>
              </Field>
              <Field
                label={`完全性フィルタ：${(prep.minCompleteness * 100).toFixed(0)}%`}
                hint="観測サンプルが少なすぎる特徴量を除外します。"
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
            title="群の割り当て"
            subtitle="すべての比較はこの割り当てに依存します。名前が一致する場合はサンプルシートから初期値を入れます。"
            actions={
              <Button size="sm" variant="primary" onClick={onReady} disabled={groupCounts.length < 2}>
                統計解析へ
              </Button>
            }
          >
            {groupCounts.length < 2 && (
              <div className="mb-3">
                <Callout tone="warn">
                  比較を実行するには、名前の付いた群が2つ以上必要です。
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
                    placeholder="群"
                    className="w-32"
                    aria-label={`${s} の群`}
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
              title="サンプルQC"
              subtitle="サンプル間の中央値を比較します。他から大きく外れたサンプルは、ローディングやインジェクションの問題であることが多いです。"
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
                headers={["サンプル", "群", "観測", "欠損", "中央値", "平均", "最小", "最大"]}
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
            <Card title="元データ" subtitle={`取り込み後の先頭 ${preview.rows.length} 行`}>
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
