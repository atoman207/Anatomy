"use client";

import { useMemo, useRef, useState } from "react";
import {
  Badge, Button, Callout, Card, DataTable, EmptyState, Field,
  Select, StatTile, TextInput, cx,
} from "@/components/ui";
import { useDownload, useWorkspace } from "@/components/workspace";
import {
  buildRawFileInventory, humanSize, inventoryToRows, RAW_FILE_COLUMNS,
  type RawFileInput,
} from "@/lib/data/rawfiles";
import {
  sampleSheetFromInventory, sampleSheetToTable, validateSampleSheet,
  type SampleRow,
} from "@/lib/data/samplesheet";
import {
  previewRename, previewToMapping, RENAME_PRESETS, type RenameRule,
} from "@/lib/data/rename";
import { toDelimited } from "@/lib/data/csv";
import {
  inventoryToMarkdown, renameToMarkdown, sampleSheetToMarkdown,
} from "@/lib/notebook/report";

type Tab = "files" | "sheet" | "rename";

const TABS: { id: Tab; label: string }[] = [
  { id: "files", label: "Rawファイル一覧" },
  { id: "sheet", label: "サンプルシート" },
  { id: "rename", label: "ファイル名変更" },
];

export default function OrganizePage() {
  const [tab, setTab] = useState<Tab>("files");
  const ws = useWorkspace();

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold text-ink">データ整理</h1>
        <p className="mt-1 text-sm text-ink-2">
          Rawファイル一覧を作り、サンプルシートを導き、安全な一括リネームを計画します。すべてブラウザ内で動作します。
        </p>
      </header>

      <div role="tablist" aria-label="データ整理の手順" className="scroll-x flex gap-1 border-b border-line">
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

      {tab === "files" && <RawFilesPanel />}
      {tab === "sheet" && <SampleSheetPanel />}
      {tab === "rename" && <RenamePanel />}

      {ws.clips.length > 0 && (
        <Callout tone="good" title={`ノートへ ${ws.clips.length} 件をキューに追加済み`}>
          <a className="underline" href="/notebook">実験ノート</a> を開いて組み立ててください。
        </Callout>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Raw file list                                                       */
/* ------------------------------------------------------------------ */

function RawFilesPanel() {
  const ws = useWorkspace();
  const download = useDownload();
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);
  const [pasted, setPasted] = useState("");
  const [filter, setFilter] = useState("");

  const inventory = useMemo(
    () => (ws.files.length ? buildRawFileInventory(ws.files) : null),
    [ws.files],
  );

  function acceptFiles(list: FileList | null) {
    if (!list) return;
    const next: RawFileInput[] = Array.from(list).map((f) => ({
      name: f.name,
      size: f.size,
      modified: new Date(f.lastModified),
      path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || null,
    }));
    ws.setFiles([...ws.files, ...next]);
    ws.setInventory(buildRawFileInventory([...ws.files, ...next]));
  }

  function acceptPasted() {
    const names = pasted
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      // Tolerate `dir` / `ls -l` output by taking the last whitespace-separated token.
      .map((l) => (l.includes("\t") ? l.split("\t").pop()!.trim() : l));
    if (!names.length) return;
    const next = [...ws.files, ...names.map((name) => ({ name }))];
    ws.setFiles(next);
    ws.setInventory(buildRawFileInventory(next));
    setPasted("");
  }

  const shown = useMemo(() => {
    if (!inventory) return [];
    const q = filter.trim().toLowerCase();
    return q
      ? inventory.entries.filter((e) => e.name.toLowerCase().includes(q))
      : inventory.entries;
  }, [inventory, filter]);

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="ファイルを追加"
        subtitle="ファイル、フォルダ、または名前の一覧を貼り付けできます。読み取るのは名前とサイズのみで、内容はマシンから出ません。"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => fileInput.current?.click()}>
              ファイルを選択
            </Button>
            <Button onClick={() => dirInput.current?.click()}>
              フォルダを選択
            </Button>
            {ws.files.length > 0 && (
              <Button
                variant="danger"
                onClick={() => {
                  ws.setFiles([]);
                  ws.setInventory(null);
                }}
              >
                クリア（{ws.files.length}）
              </Button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              acceptFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={dirInput}
            type="file"
            multiple
            className="hidden"
            // @ts-expect-error non-standard but supported in Chromium and Safari
            webkitdirectory=""
            directory=""
            onChange={(e) => {
              acceptFiles(e.target.files);
              e.target.value = "";
            }}
          />

          <Field
            label="または名前を貼り付け（1行に1つ）"
            hint="この画面から参照できない装置PC上のファイルに便利です。"
          >
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={"Control_1.raw\nControl_2.raw\nIL1b_1.raw"}
              className="min-h-24 w-full rounded-lg border border-line-strong bg-surface-1 px-2.5 py-1.5 font-mono text-xs text-ink outline-none focus:border-accent"
            />
          </Field>
          <div>
            <Button onClick={acceptPasted} disabled={!pasted.trim()}>
              貼り付けた名前を追加
            </Button>
          </div>
        </div>
      </Card>

      {!inventory && <EmptyState title="ファイルはまだありません">上からファイルを追加すると一覧ができます。</EmptyState>}

      {inventory && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="ファイル" value={inventory.entries.length} />
            <StatTile label="合計サイズ" value={humanSize(inventory.totalSize) || "—"} />
            <StatTile label="ファイル種類" value={inventory.extensions.length} />
            <StatTile
              label="問題"
              value={inventory.issues.length}
              tone={inventory.issues.length ? "danger" : "good"}
            />
          </div>

          {(inventory.issues.length > 0 || inventory.notes.length > 0) && (
            <div className="flex flex-col gap-2">
              {inventory.issues.map((m, i) => (
                <Callout key={`e${i}`} tone="danger">{m}</Callout>
              ))}
              {inventory.notes.map((m, i) => (
                <Callout key={`n${i}`} tone="warn">{m}</Callout>
              ))}
            </div>
          )}

          <Card
            title="ファイル一覧"
            subtitle={`${inventory.entries.length} 件中 ${shown.length} 件を表示`}
            actions={
              <>
                <TextInput
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="絞り込み…"
                  className="w-40"
                  aria-label="ファイルを絞り込み"
                />
                <Button
                  size="sm"
                  onClick={() =>
                    download(
                      "raw_file_list.csv",
                      toDelimited([...RAW_FILE_COLUMNS], inventoryToRows(inventory)),
                      "text/csv",
                    )
                  }
                >
                  CSV
                </Button>
                <Button
                  size="sm"
                  onClick={() => ws.addClip("Rawファイル一覧", inventoryToMarkdown(inventory))}
                >
                  ノートへ
                </Button>
              </>
            }
          >
            <DataTable
              maxHeight="30rem"
              headers={["#", "ファイル", "種類", "サイズ", "群", "反復", "順", "問題"]}
              align={["right", "left", "left", "right", "left", "right", "right", "left"]}
              rows={shown.map((e) => [
                e.index + 1,
                <span key="n" className="font-mono">{e.name}</span>,
                e.platform,
                e.sizeHuman || "—",
                e.inferredGroup ?? "—",
                e.inferredReplicate ?? "—",
                e.inferredOrder ?? "—",
                e.issues.length ? <Badge key="i" tone="danger">{e.issues.length}</Badge> : "",
              ])}
            />
          </Card>

          {inventory.groupSummary.length > 0 && (
            <Card title="推定グループ" subtitle="ファイル名のトークンから推定しています。サンプルシートタブで修正してください。">
              <DataTable
                headers={["群", "ファイル数", "例"]}
                align={["left", "right", "left"]}
                rows={inventory.groupSummary.map((g) => [
                  g.group,
                  g.replicates,
                  <span key="f" className="font-mono text-ink-3">{g.files[0]}</span>,
                ])}
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sample sheet                                                        */
/* ------------------------------------------------------------------ */

function SampleSheetPanel() {
  const ws = useWorkspace();
  const download = useDownload();
  const [rows, setRows] = useState<SampleRow[] | null>(null);

  const inventory = useMemo(
    () => (ws.files.length ? buildRawFileInventory(ws.files) : null),
    [ws.files],
  );

  const sheet = useMemo(() => {
    if (rows) return validateSampleSheet(rows, ws.sheet?.extraColumns ?? []);
    if (inventory) return sampleSheetFromInventory(inventory);
    return null;
  }, [rows, inventory, ws.sheet?.extraColumns]);

  function edit(index: number, key: keyof SampleRow, value: string) {
    if (!sheet) return;
    const next = sheet.rows.map((r, i) => {
      if (i !== index) return r;
      if (key === "replicate" || key === "run_order") {
        const n = value.trim() === "" ? null : Number(value);
        return { ...r, [key]: Number.isFinite(n as number) ? n : null };
      }
      return { ...r, [key]: value };
    });
    setRows(next);
  }

  if (!sheet) {
    return (
      <EmptyState title="サンプルシートはまだありません">
        最初のタブでRawファイルを追加すると、サンプルシートが自動で提案されます。
      </EmptyState>
    );
  }

  const errors = sheet.issues.filter((i) => i.level === "error");
  const warnings = sheet.issues.filter((i) => i.level === "warning");
  const table = sampleSheetToTable(sheet);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="サンプル" value={sheet.rows.length} />
        <StatTile label="群" value={sheet.groups.length} />
        <StatTile label="エラー" value={errors.length} tone={errors.length ? "danger" : "good"} />
        <StatTile label="警告" value={warnings.length} tone={warnings.length ? "warn" : "good"} />
      </div>

      {errors.length > 0 && (
        <Callout tone="danger" title="解析前に修正してください">
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {errors.map((e, i) => (
              <li key={i}>{e.row !== null ? `${e.row + 1} 行目: ` : ""}{e.message}</li>
            ))}
          </ul>
        </Callout>
      )}
      {warnings.length > 0 && (
        <Callout tone="warn" title="確認した方がよい項目">
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {warnings.map((e, i) => (
              <li key={i}>{e.row !== null ? `${e.row + 1} 行目: ` : ""}{e.message}</li>
            ))}
          </ul>
        </Callout>
      )}

      <Card
        title="サンプルシート"
        subtitle="どのセルも編集できます。群は以降のすべての比較を決めます。"
        actions={
          <>
            <Button
              size="sm"
              onClick={() =>
                download("sample_sheet.csv", toDelimited(table.headers, table.rows), "text/csv")
              }
            >
              CSV
            </Button>
            <Button size="sm" onClick={() => ws.addClip("サンプルシート", sampleSheetToMarkdown(sheet))}>
              ノートへ
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => ws.setSheet(sheet)}
              disabled={!sheet.valid}
              title={sheet.valid ? "" : "先にエラーを解消してください"}
            >
              このシートを使う
            </Button>
          </>
        }
      >
        <div className="scroll-x rounded-lg border border-line">
          <table className="w-full border-collapse text-xs">
            <thead className="bg-surface-2">
              <tr>
                {["サンプルID", "ファイル", "群", "反復", "バッチ", "順"].map((h) => (
                  <th key={h} className="whitespace-nowrap border-b border-line px-2 py-2 text-left font-semibold text-ink-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((r, i) => (
                <tr key={i} className="even:bg-surface-2/40">
                  <td className="border-b border-line p-1">
                    <CellInput value={r.sample_id} onChange={(v) => edit(i, "sample_id", v)} mono />
                  </td>
                  <td className="border-b border-line p-1">
                    <CellInput value={r.file_name} onChange={(v) => edit(i, "file_name", v)} mono />
                  </td>
                  <td className="border-b border-line p-1">
                    <CellInput value={r.group} onChange={(v) => edit(i, "group", v)} />
                  </td>
                  <td className="border-b border-line p-1">
                    <CellInput value={r.replicate?.toString() ?? ""} onChange={(v) => edit(i, "replicate", v)} width="4rem" />
                  </td>
                  <td className="border-b border-line p-1">
                    <CellInput value={r.batch ?? ""} onChange={(v) => edit(i, "batch", v)} width="6rem" />
                  </td>
                  <td className="border-b border-line p-1">
                    <CellInput value={r.run_order?.toString() ?? ""} onChange={(v) => edit(i, "run_order", v)} width="4rem" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="群の構成">
        <DataTable
          headers={["群", "n", "状態"]}
          align={["left", "right", "left"]}
          rows={sheet.groups.map((g) => [
            g.name,
            g.n,
            g.n >= 3
              ? <Badge key="s" tone="good">問題なし</Badge>
              : g.n === 2
                ? <Badge key="s" tone="warn">n=2、不安定</Badge>
                : <Badge key="s" tone="danger">2以上が必要</Badge>,
          ])}
        />
      </Card>
    </div>
  );
}

function CellInput({
  value, onChange, mono, width,
}: {
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  width?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={width ? { width } : undefined}
      className={cx(
        "w-full min-w-0 rounded border border-transparent bg-transparent px-1.5 py-1 text-xs text-ink outline-none hover:border-line focus:border-accent focus:bg-surface-1",
        mono && "font-mono",
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Rename                                                              */
/* ------------------------------------------------------------------ */

function RenamePanel() {
  const ws = useWorkspace();
  const download = useDownload();
  const [rules, setRules] = useState<RenameRule[]>(RENAME_PRESETS[0].rules);
  const [presetId, setPresetId] = useState(RENAME_PRESETS[0].id);
  const [find, setFind] = useState("");
  const [replaceWith, setReplaceWith] = useState("");

  const inputs = useMemo(() => {
    const sheetByFile = new Map(
      (ws.sheet?.rows ?? []).map((r) => [r.file_name, r]),
    );
    return ws.files.map((f) => {
      const row = sheetByFile.get(f.name);
      return {
        name: f.name,
        fields: {
          group: row?.group ?? "",
          replicate: row?.replicate?.toString() ?? "",
          sample: row?.sample_id ?? "",
          batch: row?.batch ?? "",
          order: row?.run_order?.toString() ?? "",
        },
      };
    });
  }, [ws.files, ws.sheet]);

  const activeRules = useMemo<RenameRule[]>(() => {
    if (!find) return rules;
    return [
      ...rules,
      { type: "replace", find, replaceWith, all: true, caseSensitive: false },
    ];
  }, [rules, find, replaceWith]);

  const preview = useMemo(
    () => (inputs.length ? previewRename(inputs, activeRules) : null),
    [inputs, activeRules],
  );

  if (!inputs.length) {
    return <EmptyState title="ファイルが読み込まれていません">最初のタブでファイルを追加すると、リネームを計画できます。</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="変更ルール"
        subtitle="拡張子は常に保持されます。ディスクには書き込みません。マッピングを書き出して、自分のスクリプトで適用してください。"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="プリセット" hint={RENAME_PRESETS.find((p) => p.id === presetId)?.description}>
            <Select
              value={presetId}
              onChange={(e) => {
                const p = RENAME_PRESETS.find((x) => x.id === e.target.value);
                setPresetId(e.target.value);
                if (p) setRules(p.rules);
              }}
            >
              {RENAME_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="検索">
              <TextInput value={find} onChange={(e) => setFind(e.target.value)} placeholder="置換前" />
            </Field>
            <Field label="置換後">
              <TextInput value={replaceWith} onChange={(e) => setReplaceWith(e.target.value)} placeholder="置換後" />
            </Field>
          </div>
        </div>
      </Card>

      {preview && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="ファイル" value={preview.rows.length} />
            <StatTile label="変更" value={preview.changedCount} tone="accent" />
            <StatTile
              label="衝突"
              value={preview.collisions.length}
              tone={preview.collisions.length ? "danger" : "good"}
            />
            <StatTile
              label="適用可能"
              value={preview.safe ? "はい" : "いいえ"}
              tone={preview.safe ? "good" : "danger"}
            />
          </div>

          {preview.issues.map((m, i) => (
            <Callout key={i} tone={preview.safe ? "warn" : "danger"}>{m}</Callout>
          ))}

          <Card
            title="プレビュー"
            actions={
              <>
                <Button
                  size="sm"
                  onClick={() =>
                    download(
                      "rename_mapping.csv",
                      toDelimited(
                        ["from", "to"],
                        previewToMapping(preview).map((m) => [m.from, m.to]),
                      ),
                      "text/csv",
                    )
                  }
                  disabled={preview.changedCount === 0}
                >
                  マッピングCSV
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    const map = previewToMapping(preview);
                    const ps = [
                      "# PowerShell — 実行前に内容を確認してください",
                      "$ErrorActionPreference = 'Stop'",
                      ...map.map(
                        (m) =>
                          `Rename-Item -LiteralPath ${JSON.stringify(m.from)} -NewName ${JSON.stringify(m.to)}`,
                      ),
                    ].join("\r\n");
                    download("rename.ps1", ps, "text/plain");
                  }}
                  disabled={!preview.safe || preview.changedCount === 0}
                >
                  スクリプト
                </Button>
                <Button size="sm" onClick={() => ws.addClip("ファイル名変更", renameToMarkdown(preview))}>
                  ノートへ
                </Button>
              </>
            }
          >
            <DataTable
              maxHeight="28rem"
              headers={["変更前", "変更後", ""]}
              rows={preview.rows.map((r) => [
                <span key="a" className="font-mono text-ink-3">{r.original}</span>,
                <span key="b" className={cx("font-mono", r.changed ? "text-ink" : "text-ink-3")}>
                  {r.proposed}
                </span>,
                r.errors.length ? (
                  <Badge key="c" tone="danger">{r.errors[0]}</Badge>
                ) : r.warnings.length ? (
                  <Badge key="c" tone="warn">{r.warnings[0]}</Badge>
                ) : r.changed ? (
                  <Badge key="c" tone="good">変更</Badge>
                ) : (
                  <span key="c" className="text-ink-3">変更なし</span>
                ),
              ])}
            />
          </Card>
        </>
      )}
    </div>
  );
}
