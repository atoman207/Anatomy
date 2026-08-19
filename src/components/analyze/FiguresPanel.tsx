"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { Button, Callout, Card, Field, Select, TextInput } from "@/components/ui";
import { useDownload, useWorkspace } from "@/components/workspace";
import type { DataMatrix } from "@/lib/stats/matrix";
import { topVariableFeatures } from "@/lib/stats/matrix";
import { differentialAnalysis } from "@/lib/stats/differential";
import { pca } from "@/lib/stats/pca";
import { renderVolcano } from "@/lib/plots/volcano";
import { renderHeatmap } from "@/lib/plots/heatmap";
import { renderPcaPlot } from "@/lib/plots/pcaPlot";
import { getTheme, groupStyles, foldGroups, type Mode } from "@/lib/plots/theme";
import type { CorrectionMethod } from "@/lib/stats/multiple";

type FigureKind = "volcano" | "heatmap" | "pca";

const KINDS: { id: FigureKind; label: string }[] = [
  { id: "volcano", label: "ボルケーノプロット" },
  { id: "heatmap", label: "ヒートマップ" },
  { id: "pca", label: "PCAプロット" },
];

/**
 * Tracks the viewer's colour scheme so figures match the page.
 *
 * Read through useSyncExternalStore: the media query is an external system,
 * and subscribing to it directly avoids the extra render an effect would cost.
 */
function subscribeToTheme(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => {
    mq.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

function readTheme(): Mode {
  if (typeof window === "undefined") return "light";
  const stamped = document.documentElement.getAttribute("data-theme");
  if (stamped === "dark" || stamped === "light") return stamped;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function useThemeMode(): Mode {
  // The server has no media query, so it always renders the light figure.
  return useSyncExternalStore(subscribeToTheme, readTheme, () => "light" as Mode);
}

export function FiguresPanel({
  matrix, groups, datasetName,
}: {
  matrix: DataMatrix;
  groups: string[];
  datasetName: string;
}) {
  const [kind, setKind] = useState<FigureKind>("volcano");
  const mode = useThemeMode();
  const groupNames = useMemo(
    () => [...new Set(groups.filter((g) => g.trim() !== ""))],
    [groups],
  );

  return (
    <div className="flex flex-col gap-4">
      <Card title="図の種類">
        <div className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <Button
              key={k.id}
              size="sm"
              icon="chart"
              variant={kind === k.id ? "primary" : "secondary"}
              onClick={() => setKind(k.id)}
            >
              {k.label}
            </Button>
          ))}
        </div>
      </Card>

      {kind === "volcano" && (
        <VolcanoFigure matrix={matrix} groups={groups} groupNames={groupNames} mode={mode} />
      )}
      {kind === "heatmap" && (
        <HeatmapFigure matrix={matrix} groups={groups} mode={mode} datasetName={datasetName} />
      )}
      {kind === "pca" && (
        <PcaFigure matrix={matrix} groups={groups} mode={mode} datasetName={datasetName} />
      )}
    </div>
  );
}

/**
 * Renders an SVG string plus its export controls.
 *
 * The same string is displayed and exported, so what a researcher puts in a
 * paper is exactly what they reviewed on screen.
 */
function FigureFrame({
  svg, filename, title, notes, children,
}: {
  svg: string;
  filename: string;
  title: string;
  notes?: string[];
  children?: React.ReactNode;
}) {
  const download = useDownload();
  const ws = useWorkspace();
  const [busy, setBusy] = useState(false);

  async function downloadPng(scale: number) {
    setBusy(true);
    try {
      const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("図をラスター化できませんでした。"));
        img.src = url;
      });
      const w = img.naturalWidth || 900;
      const h = img.naturalHeight || 600;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvasを利用できません。");
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      const png = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      if (png) download(filename.replace(/\.svg$/, ".png"), png, "image/png");
    } catch {
      // Fall back to the vector file, which always works.
      download(filename, svg, "image/svg+xml");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={title}
      actions={
        <>
          <Button size="sm" icon="download" onClick={() => download(filename, svg, "image/svg+xml")}>SVG</Button>
          <Button size="sm" icon="download" onClick={() => downloadPng(2)} disabled={busy}>
            {busy ? "…" : "PNG ×2"}
          </Button>
          <Button size="sm" icon="download" onClick={() => downloadPng(4)} disabled={busy}>PNG ×4</Button>
          <Button
            size="sm"
            icon="notebook"
            onClick={() =>
              ws.addClip(title, `### ${title}\n\n_図を ${filename} として書き出しました。_\n`)
            }
          >
            ノートへ
          </Button>
        </>
      }
    >
      {children}
      {notes && notes.length > 0 && (
        <div className="mb-3 flex flex-col gap-2">
          {notes.map((n, i) => <Callout key={i} tone="info">{n}</Callout>)}
        </div>
      )}
      <div
        className="scroll-x rounded-lg border border-line"
        // The SVG is generated by this app from the loaded data; no user HTML
        // is interpolated into it.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function VolcanoFigure({
  matrix, groups, groupNames, mode,
}: {
  matrix: DataMatrix;
  groups: string[];
  groupNames: string[];
  mode: Mode;
}) {
  const [a, setA] = useState(groupNames[1] ?? groupNames[0] ?? "");
  const [b, setB] = useState(groupNames[0] ?? "");
  const [correction, setCorrection] = useState<CorrectionMethod>("bh");
  const [pThreshold, setPThreshold] = useState(0.05);
  const [fcThreshold, setFcThreshold] = useState(1);
  const [labelTop, setLabelTop] = useState(12);
  const [highlight, setHighlight] = useState("");

  const result = useMemo(() => {
    if (!a || !b || a === b) return null;
    const cols = (name: string) =>
      groups.map((g, i) => (g === name ? i : -1)).filter((i) => i >= 0);
    return differentialAnalysis(matrix, cols(a), cols(b), a, b, {
      test: "welch", correction, dataIsLog: true, pThreshold, fcThreshold, useAdjusted: true,
    });
  }, [matrix, groups, a, b, correction, pThreshold, fcThreshold]);

  const render = useMemo(() => {
    if (!result) return null;
    return renderVolcano(result, {
      mode,
      labelTop,
      highlight: highlight.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean),
      title: `${a} vs ${b}`,
    });
  }, [result, mode, labelTop, highlight, a, b]);

  if (groupNames.length < 2) {
    return <Callout tone="warn">取り込みタブで少なくとも2つの群を割り当ててください。</Callout>;
  }

  return (
    <>
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
          <Field label="補正">
            <Select value={correction} onChange={(e) => setCorrection(e.target.value as CorrectionMethod)}>
              <option value="bh">BH FDR</option>
              <option value="by">BY FDR</option>
              <option value="bonferroni">Bonferroni</option>
              <option value="holm">Holm</option>
              <option value="none">なし</option>
            </Select>
          </Field>
          <Field label="p 閾値">
            <Select value={String(pThreshold)} onChange={(e) => setPThreshold(Number(e.target.value))}>
              {[0.1, 0.05, 0.01, 0.001].map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </Field>
          <Field label={`|log2FC| ≥ ${fcThreshold}`}>
            <input
              type="range" min={0} max={4} step={0.25} value={fcThreshold}
              onChange={(e) => setFcThreshold(Number(e.target.value))}
              className="w-full accent-[var(--accent)]"
            />
          </Field>
          <Field label={`ラベル数: ${labelTop}`}>
            <input
              type="range" min={0} max={40} value={labelTop}
              onChange={(e) => setLabelTop(Number(e.target.value))}
              className="w-full accent-[var(--accent)]"
            />
          </Field>
          <Field label="強調" className="lg:col-span-2">
            <TextInput
              value={highlight}
              onChange={(e) => setHighlight(e.target.value)}
            />
          </Field>
        </div>
      </Card>

      {a === b && <Callout tone="warn">異なる2つの群を選んでください。</Callout>}

      {render && result && (
        <FigureFrame
          svg={render.svg}
          filename={`volcano_${a}_vs_${b}.svg`}
          title={`ボルケーノプロット — ${a} vs ${b}`}
          notes={result.notes}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function HeatmapFigure({
  matrix, groups, mode, datasetName,
}: {
  matrix: DataMatrix;
  groups: string[];
  mode: Mode;
  datasetName: string;
}) {
  const [topN, setTopN] = useState(40);
  const [scaling, setScaling] = useState<"row-zscore" | "column-zscore" | "none">("row-zscore");
  const [clusterRows, setClusterRows] = useState(true);
  const [clusterColumns, setClusterColumns] = useState(true);
  const [linkage, setLinkage] = useState<"average" | "complete" | "single" | "ward">("average");
  const [metric, setMetric] = useState<"euclidean" | "correlation" | "manhattan" | "cosine">("euclidean");

  const render = useMemo(() => {
    const theme = getTheme(mode);
    const folded = foldGroups(groups.map((g) => g || "未分類"));
    const styles = groupStyles(folded.order, theme);
    const colors: Record<string, string> = {};
    for (const s of styles) colors[s.name] = s.color;
    const sub = topVariableFeatures(matrix, topN);
    return renderHeatmap(sub, {
      mode,
      title: `変動が大きい特徴量 上位 ${sub.features.length}`,
      scaling, clusterRows, clusterColumns, linkage, metric,
      columnGroups: folded.labels,
      columnGroupColors: colors,
      cellHeight: topN > 60 ? 11 : 15,
    });
  }, [matrix, groups, mode, topN, scaling, clusterRows, clusterColumns, linkage, metric]);

  return (
    <>
      <Card title="設定">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={`表示数: 変動上位 ${topN}`}>
            <input
              type="range" min={10} max={120} step={5} value={topN}
              onChange={(e) => setTopN(Number(e.target.value))}
              className="w-full accent-[var(--accent)]"
            />
          </Field>
          <Field label="標準化" hint="行のzスコアにすると、特徴量間のパターンを比較しやすくなります。">
            <Select value={scaling} onChange={(e) => setScaling(e.target.value as typeof scaling)}>
              <option value="row-zscore">行のzスコア</option>
              <option value="column-zscore">列のzスコア</option>
              <option value="none">生の値</option>
            </Select>
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
        <div className="mt-3 flex flex-wrap gap-5">
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={clusterRows} onChange={(e) => setClusterRows(e.target.checked)} />
            行クラスタリング
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={clusterColumns} onChange={(e) => setClusterColumns(e.target.checked)} />
            列クラスタリング
          </label>
        </div>
      </Card>

      <FigureFrame
        svg={render.svg}
        filename="heatmap.svg"
        title={`ヒートマップ — ${datasetName}`}
        notes={render.notes}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */

function PcaFigure({
  matrix, groups, mode, datasetName,
}: {
  matrix: DataMatrix;
  groups: string[];
  mode: Mode;
  datasetName: string;
}) {
  const [center, setCenter] = useState(true);
  const [scale, setScale] = useState(false);
  const [xc, setXc] = useState(0);
  const [yc, setYc] = useState(1);
  const [ellipses, setEllipses] = useState(true);
  const [labels, setLabels] = useState(true);

  const result = useMemo(() => pca(matrix, { center, scale }), [matrix, center, scale]);

  const render = useMemo(
    () =>
      renderPcaPlot(result, {
        mode,
        groups: groups.map((g) => g || null),
        xComponent: xc,
        yComponent: yc,
        showEllipses: ellipses,
        showSampleLabels: labels,
        title: `PCA — ${datasetName}`,
      }),
    [result, mode, groups, xc, yc, ellipses, labels, datasetName],
  );

  const options = Array.from({ length: Math.max(1, result.nComponents) }, (_, i) => i);

  return (
    <>
      <Card title="設定">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="X軸">
            <Select value={String(xc)} onChange={(e) => setXc(Number(e.target.value))}>
              {options.map((i) => (
                <option key={i} value={i}>
                  PC{i + 1} ({((result.explained[i] ?? 0) * 100).toFixed(1)}%)
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Y軸">
            <Select value={String(yc)} onChange={(e) => setYc(Number(e.target.value))}>
              {options.map((i) => (
                <option key={i} value={i}>
                  PC{i + 1} ({((result.explained[i] ?? 0) * 100).toFixed(1)}%)
                </option>
              ))}
            </Select>
          </Field>
          <Field label="前処理">
            <div className="flex h-9 flex-wrap items-center gap-4">
              <label className="flex items-center gap-1.5 text-xs text-ink-2">
                <input type="checkbox" checked={center} onChange={(e) => setCenter(e.target.checked)} />
                中心化
              </label>
              <label className="flex items-center gap-1.5 text-xs text-ink-2">
                <input type="checkbox" checked={scale} onChange={(e) => setScale(e.target.checked)} />
                スケール
              </label>
            </div>
          </Field>
          <Field label="表示">
            <div className="flex h-9 flex-wrap items-center gap-4">
              <label className="flex items-center gap-1.5 text-xs text-ink-2">
                <input type="checkbox" checked={ellipses} onChange={(e) => setEllipses(e.target.checked)} />
                95%楕円
              </label>
              <label className="flex items-center gap-1.5 text-xs text-ink-2">
                <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} />
                ラベル
              </label>
            </div>
          </Field>
        </div>
      </Card>

      <FigureFrame
        svg={render.svg}
        filename="pca_plot.svg"
        title={`PCAスコアプロット — ${datasetName}`}
        notes={render.notes}
      />
    </>
  );
}
