"use client";

import { useMemo, useState } from "react";
import {
  Badge, Button, Callout, Card, DataTable, Field, Select, StatTile, TextInput,
} from "@/components/ui";
import { useDownload, useWorkspace } from "@/components/workspace";
import type { DataMatrix } from "@/lib/stats/matrix";
import { twoSampleTTest, pairedTTest, mannWhitneyU } from "@/lib/stats/ttest";
import { oneWayAnova, kruskalWallis } from "@/lib/stats/anova";
import { pca } from "@/lib/stats/pca";
import { kMeans, hierarchical, cutTree } from "@/lib/stats/clustering";
import { differentialAnalysis } from "@/lib/stats/differential";
import { adjustPValues, CORRECTION_LABELS, type CorrectionMethod } from "@/lib/stats/multiple";
import { toDelimited } from "@/lib/data/csv";
import {
  tTestToMarkdown, anovaToMarkdown, pcaToMarkdown, kMeansToMarkdown,
  hierarchicalToMarkdown, differentialToMarkdown, formatP,
} from "@/lib/notebook/report";

type Method = "ttest" | "anova" | "pca" | "cluster" | "differential";

const METHODS: { id: Method; label: string; needs: string }[] = [
  { id: "ttest", label: "t検定", needs: "2群" },
  { id: "anova", label: "ANOVA", needs: "2群以上" },
  { id: "pca", label: "PCA", needs: "3サンプル以上" },
  { id: "cluster", label: "クラスタリング", needs: "3サンプル以上" },
  { id: "differential", label: "差次発現", needs: "2群" },
];

export function StatsPanel({
  matrix, groups, datasetName,
}: {
  matrix: DataMatrix;
  groups: string[];
  datasetName: string;
}) {
  const [method, setMethod] = useState<Method>("differential");

  const groupNames = useMemo(
    () => [...new Set(groups.filter((g) => g.trim() !== ""))],
    [groups],
  );

  return (
    <div className="flex flex-col gap-4">
      <Card title="解析手法">
        <div className="flex flex-wrap gap-2">
          {METHODS.map((m) => (
            <Button
              key={m.id}
              size="sm"
              variant={method === m.id ? "primary" : "secondary"}
              onClick={() => setMethod(m.id)}
            >
              {m.label}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-3">
          {groupNames.length} 群: {groupNames.join(", ") || "未割り当て"}
        </p>
      </Card>

      {method === "ttest" && <TTestSection matrix={matrix} groups={groups} groupNames={groupNames} />}
      {method === "anova" && <AnovaSection matrix={matrix} groups={groups} groupNames={groupNames} />}
      {method === "pca" && <PcaSection matrix={matrix} groups={groups} datasetName={datasetName} />}
      {method === "cluster" && <ClusterSection matrix={matrix} groups={groups} />}
      {method === "differential" && (
        <DifferentialSection matrix={matrix} groups={groups} groupNames={groupNames} />
      )}
    </div>
  );
}

function useFeatureIndex(matrix: DataMatrix) {
  return useMemo(
    () =>
      matrix.features.map((f, i) => ({
        i,
        label: matrix.featureLabels?.[i] || f,
        feature: f,
      })),
    [matrix],
  );
}

function colsFor(groups: string[], name: string): number[] {
  return groups.map((g, i) => (g === name ? i : -1)).filter((i) => i >= 0);
}

/* ------------------------------------------------------------------ */
/* t-test                                                              */
/* ------------------------------------------------------------------ */

function TTestSection({
  matrix, groups, groupNames,
}: {
  matrix: DataMatrix;
  groups: string[];
  groupNames: string[];
}) {
  const ws = useWorkspace();
  const download = useDownload();
  const features = useFeatureIndex(matrix);
  const [a, setA] = useState(groupNames[0] ?? "");
  const [b, setB] = useState(groupNames[1] ?? "");
  const [variant, setVariant] = useState<"welch" | "student" | "paired" | "mw">("welch");
  const [featureQuery, setFeatureQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const matches = useMemo(() => {
    const q = featureQuery.trim().toLowerCase();
    if (!q) return features.slice(0, 30);
    return features
      .filter((f) => f.label.toLowerCase().includes(q) || f.feature.toLowerCase().includes(q))
      .slice(0, 30);
  }, [features, featureQuery]);

  const result = useMemo(() => {
    if (!a || !b || a === b) return null;
    const ia = colsFor(groups, a);
    const ib = colsFor(groups, b);
    const row = matrix.values[selected];
    if (!row) return null;
    const va = ia.map((i) => row[i]);
    const vb = ib.map((i) => row[i]);
    if (variant === "mw") {
      const mw = mannWhitneyU(va, vb);
      return { kind: "mw" as const, mw };
    }
    const t =
      variant === "paired"
        ? pairedTTest(va, vb)
        : twoSampleTTest(va, vb, { equalVariance: variant === "student" });
    return { kind: "t" as const, t };
  }, [a, b, groups, matrix, selected, variant]);

  const label = features[selected]?.label ?? "";

  // Per-feature test across everything, for the export.
  const allRows = useMemo(() => {
    if (!a || !b || a === b) return [];
    const ia = colsFor(groups, a);
    const ib = colsFor(groups, b);
    return matrix.values.map((row, i) => {
      const va = ia.map((k) => row[k]);
      const vb = ib.map((k) => row[k]);
      const r = variant === "paired"
        ? pairedTTest(va, vb)
        : twoSampleTTest(va, vb, { equalVariance: variant === "student" });
      return {
        feature: matrix.featureLabels?.[i] || matrix.features[i],
        meanA: r.meanA, meanB: r.meanB ?? NaN, diff: r.diff,
        t: r.t, df: r.df, p: r.p, d: r.cohensD,
      };
    });
  }, [a, b, groups, matrix, variant]);

  if (groupNames.length < 2) {
    return <Callout tone="warn">取り込みタブで少なくとも2つの群を割り当ててください。</Callout>;
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title="設定">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="群A">
            <Select value={a} onChange={(e) => setA(e.target.value)}>
              {groupNames.map((g) => <option key={g} value={g}>{g}</option>)}
            </Select>
          </Field>
          <Field label="群B">
            <Select value={b} onChange={(e) => setB(e.target.value)}>
              {groupNames.map((g) => <option key={g} value={g}>{g}</option>)}
            </Select>
          </Field>
          <Field label="検定" hint="Welchは等分散を仮定しません。">
            <Select value={variant} onChange={(e) => setVariant(e.target.value as typeof variant)}>
              <option value="welch">Welchのt検定</option>
              <option value="student">Studentのt検定</option>
              <option value="paired">対応のあるt検定</option>
              <option value="mw">Mann-Whitney U</option>
            </Select>
          </Field>
          <Field label="特徴量">
            <TextInput
              value={featureQuery}
              onChange={(e) => setFeatureQuery(e.target.value)}
              placeholder="検索…"
            />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {matches.map((f) => (
            <button
              key={f.i}
              onClick={() => setSelected(f.i)}
              className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                selected === f.i
                  ? "bg-accent text-accent-contrast"
                  : "bg-surface-2 text-ink-2 hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Card>

      {a === b && <Callout tone="warn">異なる2つの群を選んでください。</Callout>}

      {result?.kind === "t" && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="t" value={num(result.t.t)} />
            <StatTile label="df" value={num(result.t.df, 2)} />
            <StatTile
              label="p"
              value={formatP(result.t.p)}
              tone={result.t.p < 0.05 ? "good" : undefined}
              hint={sig(result.t.p)}
            />
            <StatTile label="Cohen's d" value={num(result.t.cohensD, 2)} />
          </div>
          <Card
            title={`${label} — ${result.t.test}`}
            actions={
              <Button size="sm" onClick={() => ws.addClip(`t検定: ${label}`, tTestToMarkdown(result.t, `${label} — ${a} vs ${b}`))}>
                ノートへ
              </Button>
            }
          >
            <DataTable
              headers={["項目", "値"]}
              rows={[
                ["n", `${result.t.nA} vs ${result.t.nB}`],
                ["平均", `${num(result.t.meanA)} vs ${num(result.t.meanB ?? NaN)}`],
                ["差", num(result.t.diff)],
                ["差の95% CI", `${num(result.t.ci95[0])} ～ ${num(result.t.ci95[1])}`],
                ["標準誤差", num(result.t.stderr)],
              ]}
            />
            {result.t.notes.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                {result.t.notes.map((n, i) => <Callout key={i} tone="warn">{n}</Callout>)}
              </div>
            )}
          </Card>
        </>
      )}

      {result?.kind === "mw" && (
        <Card title={`${label} — Mann-Whitney U`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="U" value={num(result.mw.u, 1)} />
            <StatTile label="z" value={num(result.mw.z, 3)} />
            <StatTile label="p" value={formatP(result.mw.p)} tone={result.mw.p < 0.05 ? "good" : undefined} />
            <StatTile label="n" value={`${result.mw.nA} vs ${result.mw.nB}`} />
          </div>
          {result.mw.notes.map((n, i) => (
            <div key={i} className="mt-2"><Callout tone="warn">{n}</Callout></div>
          ))}
        </Card>
      )}

      {allRows.length > 0 && (
        <Card
          title="全特徴量"
          subtitle="同じ検定をすべての行に適用します。FDR制御は差次発現タブを使ってください。"
          actions={
            <Button
              size="sm"
              onClick={() =>
                download(
                  `ttest_${a}_vs_${b}.csv`,
                  toDelimited(
                    ["feature", "mean_A", "mean_B", "difference", "t", "df", "p", "cohens_d"],
                    allRows.map((r) => [r.feature, r.meanA, r.meanB, r.diff, r.t, r.df, r.p, r.d]),
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
            headers={["特徴量", `平均 ${a}`, `平均 ${b}`, "差", "t", "p"]}
            align={["left", "right", "right", "right", "right", "right"]}
            rows={[...allRows]
              .sort((x, y) => (x.p || 1) - (y.p || 1))
              .slice(0, 200)
              .map((r) => [
                r.feature, num(r.meanA), num(r.meanB), num(r.diff), num(r.t, 2),
                <span key="p" className={r.p < 0.05 ? "text-good font-medium" : ""}>{formatP(r.p)}</span>,
              ])}
          />
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ANOVA                                                               */
/* ------------------------------------------------------------------ */

function AnovaSection({
  matrix, groups, groupNames,
}: {
  matrix: DataMatrix;
  groups: string[];
  groupNames: string[];
}) {
  const ws = useWorkspace();
  const download = useDownload();
  const features = useFeatureIndex(matrix);
  const [selected, setSelected] = useState(0);
  const [query, setQuery] = useState("");
  const [useRank, setUseRank] = useState(false);
  const [correction, setCorrection] = useState<CorrectionMethod>("bh");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return features.slice(0, 30);
    return features.filter((f) => f.label.toLowerCase().includes(q)).slice(0, 30);
  }, [features, query]);

  const anova = useMemo(() => {
    const row = matrix.values[selected];
    if (!row) return null;
    return oneWayAnova(
      groupNames.map((g) => ({ name: g, values: colsFor(groups, g).map((i) => row[i]) })),
    );
  }, [matrix, selected, groups, groupNames]);

  const kw = useMemo(() => {
    if (!useRank) return null;
    const row = matrix.values[selected];
    if (!row) return null;
    return kruskalWallis(
      groupNames.map((g) => ({ name: g, values: colsFor(groups, g).map((i) => row[i]) })),
    );
  }, [useRank, matrix, selected, groups, groupNames]);

  /** Omnibus F for every feature, with multiple-testing control. */
  const allRows = useMemo(() => {
    const raw = matrix.values.map((row, i) => {
      const r = oneWayAnova(
        groupNames.map((g) => ({ name: g, values: colsFor(groups, g).map((k) => row[k]) })),
        { tukey: false },
      );
      return {
        feature: matrix.featureLabels?.[i] || matrix.features[i],
        f: r.f, p: r.p, eta: r.etaSquared,
      };
    });
    const padj = adjustPValues(raw.map((r) => r.p), correction);
    return raw.map((r, i) => ({ ...r, padj: padj[i] }));
  }, [matrix, groups, groupNames, correction]);

  const sigCount = allRows.filter((r) => Number.isFinite(r.padj) && r.padj < 0.05).length;

  if (groupNames.length < 2) {
    return <Callout tone="warn">取り込みタブで少なくとも2つの群を割り当ててください。</Callout>;
  }

  const label = features[selected]?.label ?? "";

  return (
    <div className="flex flex-col gap-4">
      <Card title="設定">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="特徴量">
            <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="検索…" />
          </Field>
          <Field label="多重比較補正" hint="全特徴量の表に適用します。">
            <Select value={correction} onChange={(e) => setCorrection(e.target.value as CorrectionMethod)}>
              {(Object.keys(CORRECTION_LABELS) as CorrectionMethod[]).map((k) => (
                <option key={k} value={k}>{CORRECTION_LABELS[k]}</option>
              ))}
            </Select>
          </Field>
          <Field label="ノンパラメトリック" hint="正規性が疑わしいときは Kruskal-Wallis を使います。">
            <label className="flex h-9 items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" checked={useRank} onChange={(e) => setUseRank(e.target.checked)} />
              Kruskal-Wallis も実行
            </label>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {matches.map((f) => (
            <button
              key={f.i}
              onClick={() => setSelected(f.i)}
              className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                selected === f.i ? "bg-accent text-accent-contrast" : "bg-surface-2 text-ink-2 hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Card>

      {anova && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="F" value={num(anova.f, 3)} />
            <StatTile label="df" value={`${num(anova.dfBetween, 0)}, ${num(anova.dfWithin, 0)}`} />
            <StatTile label="p" value={formatP(anova.p)} tone={anova.p < 0.05 ? "good" : undefined} hint={sig(anova.p)} />
            <StatTile label="eta²" value={num(anova.etaSquared, 3)} />
          </div>

          <Card
            title={`${label} — 分散分析表`}
            actions={
              <Button size="sm" onClick={() => ws.addClip(`ANOVA: ${label}`, anovaToMarkdown(anova, `${label} — 一元配置ANOVA`))}>
                ノートへ
              </Button>
            }
          >
            <DataTable
              headers={["要因", "df", "SS", "MS", "F", "p"]}
              align={["left", "right", "right", "right", "right", "right"]}
              rows={[
                ["群間", num(anova.dfBetween, 0), num(anova.ssBetween), num(anova.msBetween), num(anova.f, 3), formatP(anova.p)],
                ["群内", num(anova.dfWithin, 0), num(anova.ssWithin), num(anova.msWithin), "", ""],
                ["全体", num(anova.dfTotal, 0), num(anova.ssTotal), "", "", ""],
              ]}
            />
            <div className="mt-4">
              <p className="mb-1.5 text-xs font-semibold text-ink-2">群</p>
              <DataTable
                headers={["群", "n", "平均", "SD"]}
                align={["left", "right", "right", "right"]}
                rows={anova.groups.map((g) => [g.name, g.n, num(g.mean), num(g.sd)])}
              />
            </div>
            {anova.notes.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                {anova.notes.map((n, i) => <Callout key={i} tone="warn">{n}</Callout>)}
              </div>
            )}
          </Card>

          {anova.tukey.length > 0 && (
            <Card title="Tukey HSD 事後検定" subtitle="すべてのペア比較。ファミリーwise誤差率を制御します。">
              <DataTable
                headers={["比較", "差", "95% CI", "q", "p", ""]}
                align={["left", "right", "left", "right", "right", "left"]}
                rows={anova.tukey.map((t) => [
                  `${t.a} vs ${t.b}`,
                  num(t.diff),
                  `${num(t.ci95[0])} — ${num(t.ci95[1])}`,
                  num(t.q, 2),
                  formatP(t.p),
                  t.significant ? <Badge key="s" tone="good">有意</Badge> : <span key="s" className="text-ink-3">ns</span>,
                ])}
              />
            </Card>
          )}

          {kw && (
            <Card title="Kruskal-Wallis">
              <div className="grid grid-cols-3 gap-3">
                <StatTile label="H" value={num(kw.h, 3)} />
                <StatTile label="df" value={num(kw.df, 0)} />
                <StatTile label="p" value={formatP(kw.p)} tone={kw.p < 0.05 ? "good" : undefined} />
              </div>
              {kw.notes.map((n, i) => <div key={i} className="mt-2"><Callout tone="info">{n}</Callout></div>)}
            </Card>
          )}
        </>
      )}

      <Card
        title="全特徴量のANOVA"
        subtitle={`調整p < 0.05 の特徴量: ${sigCount}（${CORRECTION_LABELS[correction]}）`}
        actions={
          <Button
            size="sm"
            onClick={() =>
              download(
                "anova_all_features.csv",
                toDelimited(
                  ["feature", "F", "p", "p_adjusted", "eta_squared"],
                  allRows.map((r) => [r.feature, r.f, r.p, r.padj, r.eta]),
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
          headers={["特徴量", "F", "p", "調整p", "eta²"]}
          align={["left", "right", "right", "right", "right"]}
          rows={[...allRows]
            .sort((a, b) => (a.p || 1) - (b.p || 1))
            .slice(0, 200)
            .map((r) => [
              r.feature, num(r.f, 2), formatP(r.p),
              <span key="q" className={Number.isFinite(r.padj) && r.padj < 0.05 ? "text-good font-medium" : ""}>
                {formatP(r.padj)}
              </span>,
              num(r.eta, 3),
            ])}
        />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PCA                                                                 */
/* ------------------------------------------------------------------ */

function PcaSection({
  matrix, groups, datasetName,
}: {
  matrix: DataMatrix;
  groups: string[];
  datasetName: string;
}) {
  const ws = useWorkspace();
  const download = useDownload();
  const [center, setCenter] = useState(true);
  const [scale, setScale] = useState(false);

  const result = useMemo(
    () => pca(matrix, { center, scale }),
    [matrix, center, scale],
  );

  return (
    <div className="flex flex-col gap-4">
      <Card title="設定">
        <div className="flex flex-wrap gap-5">
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={center} onChange={(e) => setCenter(e.target.checked)} />
            特徴量を中心化
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={scale} onChange={(e) => setScale(e.target.checked)} />
            単位分散にスケーリング
          </label>
        </div>
        <p className="mt-2 text-xs text-ink-3">
          スケーリングは各特徴量を等しい重みにします。単位が異なる特徴量があるときに適しています。
        </p>
      </Card>

      {result.notes.map((n, i) => <Callout key={i} tone="info">{n}</Callout>)}

      {result.nComponents > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="PC1" value={`${(result.explained[0] * 100).toFixed(1)}%`} />
            <StatTile label="PC2" value={`${((result.explained[1] ?? 0) * 100).toFixed(1)}%`} />
            <StatTile label="PC1+PC2" value={`${((result.cumulative[1] ?? result.cumulative[0]) * 100).toFixed(1)}%`} tone="accent" />
            <StatTile label="成分数" value={result.nComponents} />
          </div>

          <Card
            title="寄与率"
            actions={
              <>
                <Button
                  size="sm"
                  onClick={() =>
                    download(
                      "pca_scores.csv",
                      toDelimited(
                        ["sample", "group", ...result.eigenvalues.map((_, i) => `PC${i + 1}`)],
                        result.sampleNames.map((s, i) => [s, groups[i] ?? "", ...result.scores[i]]),
                      ),
                      "text/csv",
                    )
                  }
                >
                  スコアCSV
                </Button>
                <Button size="sm" onClick={() => ws.addClip("PCA", pcaToMarkdown(result, `PCA — ${datasetName}`))}>
                  ノートへ
                </Button>
              </>
            }
          >
            <DataTable
              headers={["成分", "固有値", "分散", "累積"]}
              align={["left", "right", "right", "right"]}
              rows={result.eigenvalues.map((ev, i) => [
                `PC${i + 1}`,
                num(ev, 4),
                `${(result.explained[i] * 100).toFixed(1)}%`,
                `${(result.cumulative[i] * 100).toFixed(1)}%`,
              ])}
            />
          </Card>

          <Card title="サンプルスコア">
            <DataTable
              maxHeight="24rem"
              headers={["サンプル", "群", "PC1", "PC2", "PC3"]}
              align={["left", "left", "right", "right", "right"]}
              rows={result.sampleNames.map((s, i) => [
                <span key="s" className="font-mono">{s}</span>,
                groups[i] || "—",
                num(result.scores[i][0] ?? NaN),
                num(result.scores[i][1] ?? NaN),
                num(result.scores[i][2] ?? NaN),
              ])}
            />
          </Card>

          <Card title="主要な寄与特徴量" subtitle="PC1とPC2を駆動する特徴量。">
            <DataTable
              maxHeight="20rem"
              headers={["特徴量", "PC1 loading", "PC2 loading"]}
              align={["left", "right", "right"]}
              rows={result.featureNames
                .map((f, i) => ({
                  f,
                  l1: result.loadings[i]?.[0] ?? 0,
                  l2: result.loadings[i]?.[1] ?? 0,
                }))
                .sort((a, b) => Math.abs(b.l1) - Math.abs(a.l1))
                .slice(0, 40)
                .map((r) => {
                  const idx = matrix.features.indexOf(r.f);
                  return [
                    idx >= 0 ? matrix.featureLabels?.[idx] || r.f : r.f,
                    num(r.l1, 4),
                    num(r.l2, 4),
                  ];
                })}
            />
          </Card>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Clustering                                                          */
/* ------------------------------------------------------------------ */

function ClusterSection({ matrix, groups }: { matrix: DataMatrix; groups: string[] }) {
  const ws = useWorkspace();
  const [target, setTarget] = useState<"samples" | "features">("samples");
  const [k, setK] = useState(3);
  const [linkage, setLinkage] = useState<"average" | "complete" | "single" | "ward">("average");
  const [metric, setMetric] = useState<"euclidean" | "correlation" | "manhattan" | "cosine">("euclidean");
  const [topN, setTopN] = useState(200);

  const { vectors, names } = useMemo(() => {
    // Missing values are mean-filled here; clustering needs complete vectors.
    const filled = matrix.values.map((row) => {
      const obs = row.filter((v): v is number => v !== null && Number.isFinite(v));
      const mu = obs.length ? obs.reduce((s, v) => s + v, 0) / obs.length : 0;
      return row.map((v) => (v === null || !Number.isFinite(v) ? mu : v));
    });
    if (target === "samples") {
      return {
        vectors: matrix.samples.map((_, c) => filled.map((r) => r[c])),
        names: matrix.samples,
      };
    }
    const scored = filled
      .map((r, i) => {
        const mu = r.reduce((s, v) => s + v, 0) / r.length;
        const varr = r.reduce((s, v) => s + (v - mu) ** 2, 0) / Math.max(1, r.length - 1);
        return { i, varr };
      })
      .sort((a, b) => b.varr - a.varr)
      .slice(0, topN);
    return {
      vectors: scored.map((s) => filled[s.i]),
      names: scored.map((s) => matrix.featureLabels?.[s.i] || matrix.features[s.i]),
    };
  }, [matrix, target, topN]);

  const km = useMemo(
    () => (vectors.length ? kMeans(vectors, k, { metric }) : null),
    [vectors, k, metric],
  );
  const hc = useMemo(
    () => (vectors.length ? hierarchical(vectors, { linkage, metric }) : null),
    [vectors, linkage, metric],
  );
  const cut = useMemo(() => (hc ? cutTree(hc.root, k) : []), [hc, k]);

  return (
    <div className="flex flex-col gap-4">
      <Card title="設定">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="対象">
            <Select value={target} onChange={(e) => setTarget(e.target.value as typeof target)}>
              <option value="samples">サンプル</option>
              <option value="features">特徴量</option>
            </Select>
          </Field>
          <Field label={`クラスタ数 k = ${k}`}>
            <input
              type="range" min={2} max={Math.max(2, Math.min(12, vectors.length))}
              value={k} onChange={(e) => setK(Number(e.target.value))}
              className="w-full accent-[var(--accent)]"
            />
          </Field>
          <Field label="連結法">
            <Select value={linkage} onChange={(e) => setLinkage(e.target.value as typeof linkage)}>
              <option value="average">平均</option>
              <option value="complete">完全</option>
              <option value="single">単連結</option>
              <option value="ward">Ward</option>
            </Select>
          </Field>
          <Field label="距離">
            <Select value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)}>
              <option value="euclidean">ユークリッド</option>
              <option value="correlation">1 − Pearson r</option>
              <option value="manhattan">マンハッタン</option>
              <option value="cosine">コサイン</option>
            </Select>
          </Field>
        </div>
        {target === "features" && (
          <div className="mt-3 max-w-xs">
            <Field label={`上位変動特徴量: ${topN}`}>
              <input
                type="range" min={20} max={500} step={20}
                value={topN} onChange={(e) => setTopN(Number(e.target.value))}
                className="w-full accent-[var(--accent)]"
              />
            </Field>
          </div>
        )}
      </Card>

      {km && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="k" value={km.k} />
            <StatTile
              label="Silhouette"
              value={num(km.silhouette, 3)}
              tone={km.silhouette > 0.5 ? "good" : km.silhouette > 0.25 ? "warn" : "danger"}
              hint={km.silhouette > 0.5 ? "よく分離" : km.silhouette > 0.25 ? "弱い構造" : "構造が乏しい"}
            />
            <StatTile label="Inertia" value={num(km.inertia, 1)} />
            <StatTile label="収束" value={km.converged ? "はい" : "いいえ"} tone={km.converged ? "good" : "warn"} />
          </div>

          <Card
            title="k-means"
            actions={
              <Button size="sm" onClick={() => ws.addClip("k-meansクラスタリング", kMeansToMarkdown(km, names))}>
                ノートへ
              </Button>
            }
          >
            <DataTable
              maxHeight="20rem"
              headers={["クラスタ", "n", "メンバー"]}
              align={["left", "right", "left"]}
              rows={Array.from({ length: km.k }, (_, c) => {
                const members = names.filter((_, i) => km.assignments[i] === c);
                return [
                  `クラスタ ${c + 1}`,
                  members.length,
                  <span key="m" className="font-mono text-ink-2">
                    {members.slice(0, 10).join(", ")}
                    {members.length > 10 ? ` +${members.length - 10}` : ""}
                  </span>,
                ];
              })}
            />
          </Card>
        </>
      )}

      {hc && hc.root && (
        <Card
          title="階層クラスタリング"
          subtitle={`${linkage} 連結 · ${hc.metric}`}
          actions={
            <Button size="sm" onClick={() => ws.addClip("階層クラスタリング", hierarchicalToMarkdown(hc, names))}>
              ノートへ
            </Button>
          }
        >
          <DataTable
            maxHeight="20rem"
            headers={target === "samples" ? ["項目", "割り当て群", "クラスタ（k切断）"] : ["項目", "クラスタ（k切断）"]}
            rows={hc.order.map((leaf) => {
              const base = [<span key="n" className="font-mono">{names[leaf]}</span>];
              if (target === "samples") {
                base.push(<span key="g">{groups[leaf] || "—"}</span>);
              }
              base.push(<Badge key="c" tone="accent">{`クラスタ ${cut[leaf] + 1}`}</Badge>);
              return base;
            })}
          />
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Differential                                                        */
/* ------------------------------------------------------------------ */

function DifferentialSection({
  matrix, groups, groupNames,
}: {
  matrix: DataMatrix;
  groups: string[];
  groupNames: string[];
}) {
  const ws = useWorkspace();
  const download = useDownload();
  const [a, setA] = useState(groupNames[1] ?? groupNames[0] ?? "");
  const [b, setB] = useState(groupNames[0] ?? "");
  const [test, setTest] = useState<"welch" | "student" | "paired" | "mannwhitney">("welch");
  const [correction, setCorrection] = useState<CorrectionMethod>("bh");
  const [pThreshold, setPThreshold] = useState(0.05);
  const [fcThreshold, setFcThreshold] = useState(1);
  const [useAdjusted, setUseAdjusted] = useState(true);
  const [dataIsLog, setDataIsLog] = useState(true);

  const result = useMemo(() => {
    if (!a || !b || a === b) return null;
    return differentialAnalysis(matrix, colsFor(groups, a), colsFor(groups, b), a, b, {
      test, correction, dataIsLog, pThreshold, fcThreshold, useAdjusted,
    });
  }, [matrix, groups, a, b, test, correction, dataIsLog, pThreshold, fcThreshold, useAdjusted]);

  if (groupNames.length < 2) {
    return <Callout tone="warn">取り込みタブで少なくとも2つの群を割り当ててください。</Callout>;
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title="設定" subtitle="同じ設定が図作成タブのボルケーノプロットにも使われます。">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="群A（分子）">
            <Select value={a} onChange={(e) => setA(e.target.value)}>
              {groupNames.map((g) => <option key={g} value={g}>{g}</option>)}
            </Select>
          </Field>
          <Field label="群B（分母）">
            <Select value={b} onChange={(e) => setB(e.target.value)}>
              {groupNames.map((g) => <option key={g} value={g}>{g}</option>)}
            </Select>
          </Field>
          <Field label="検定">
            <Select value={test} onChange={(e) => setTest(e.target.value as typeof test)}>
              <option value="welch">Welchのt検定</option>
              <option value="student">Studentのt検定</option>
              <option value="paired">対応のあるt検定</option>
              <option value="mannwhitney">Mann-Whitney U</option>
            </Select>
          </Field>
          <Field label="補正">
            <Select value={correction} onChange={(e) => setCorrection(e.target.value as CorrectionMethod)}>
              {(Object.keys(CORRECTION_LABELS) as CorrectionMethod[]).map((k) => (
                <option key={k} value={k}>{CORRECTION_LABELS[k]}</option>
              ))}
            </Select>
          </Field>
          <Field label={`p 閾値: ${pThreshold}`}>
            <Select value={String(pThreshold)} onChange={(e) => setPThreshold(Number(e.target.value))}>
              {[0.1, 0.05, 0.01, 0.001].map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </Field>
          <Field label={`|log2FC| 閾値: ${fcThreshold}`}>
            <input
              type="range" min={0} max={4} step={0.25}
              value={fcThreshold} onChange={(e) => setFcThreshold(Number(e.target.value))}
              className="w-full accent-[var(--accent)]"
            />
          </Field>
          <Field label="判定基準">
            <label className="flex h-9 items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" checked={useAdjusted} onChange={(e) => setUseAdjusted(e.target.checked)} />
              調整pを使う
            </label>
          </Field>
          <Field label="データ形式" hint="対数データでは倍数変化は引き算になります。">
            <label className="flex h-9 items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" checked={dataIsLog} onChange={(e) => setDataIsLog(e.target.checked)} />
              すでに対数スケール
            </label>
          </Field>
        </div>
      </Card>

      {a === b && <Callout tone="warn">異なる2つの群を選んでください。</Callout>}

      {result && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="検定数" value={result.counts.tested} />
            <StatTile label="上昇" value={result.counts.up} tone="danger" hint={`${a} で高い`} />
            <StatTile label="低下" value={result.counts.down} tone="accent" hint={`${a} で低い`} />
            <StatTile label="変化なし" value={result.counts.ns} />
          </div>

          {result.notes.map((n, i) => <Callout key={i} tone="warn">{n}</Callout>)}

          <Card
            title={`差次発現 — ${a} vs ${b}`}
            subtitle={`${CORRECTION_LABELS[correction]} · |log2FC| ≥ ${fcThreshold} · ${useAdjusted ? "調整" : ""}p < ${pThreshold}`}
            actions={
              <>
                <Button
                  size="sm"
                  onClick={() =>
                    download(
                      `differential_${a}_vs_${b}.csv`,
                      toDelimited(
                        ["feature", "label", "mean_A", "mean_B", "log2FC", "p", "p_adjusted", "direction"],
                        result.rows.map((r) => [
                          r.feature, r.label, r.meanA, r.meanB, r.log2fc, r.p, r.padj, r.direction,
                        ]),
                      ),
                      "text/csv",
                    )
                  }
                >
                  CSV
                </Button>
                <Button size="sm" onClick={() => ws.addClip(`差次発現 ${a} vs ${b}`, differentialToMarkdown(result))}>
                  ノートへ
                </Button>
              </>
            }
          >
            <DataTable
              maxHeight="28rem"
              headers={["特徴量", "log2FC", "p", "調整p", "方向"]}
              align={["left", "right", "right", "right", "left"]}
              rows={[...result.rows]
                .sort((x, y) => {
                  const sx = x.significant ? 1 : 0;
                  const sy = y.significant ? 1 : 0;
                  if (sx !== sy) return sy - sx;
                  return (x.padj || 1) - (y.padj || 1);
                })
                .slice(0, 300)
                .map((r) => [
                  r.label,
                  num(r.log2fc, 2),
                  formatP(r.p),
                  formatP(r.padj),
                  r.direction === "up"
                    ? <Badge key="d" tone="danger">上昇</Badge>
                    : r.direction === "down"
                      ? <Badge key="d" tone="accent">低下</Badge>
                      : <span key="d" className="text-ink-3">ns</span>,
                ])}
            />
          </Card>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function num(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return "—";
  if (v !== 0 && (Math.abs(v) < 1e-3 || Math.abs(v) >= 1e6)) return v.toExponential(2);
  return v.toFixed(digits);
}

function sig(p: number): string {
  if (!Number.isFinite(p)) return "";
  if (p < 0.001) return "*** p < 0.001";
  if (p < 0.01) return "** p < 0.01";
  if (p < 0.05) return "* p < 0.05";
  return "有意でない";
}
