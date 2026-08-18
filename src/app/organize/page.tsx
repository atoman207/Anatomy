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

const TABS: { id: Tab; label: string; en: string }[] = [
  { id: "files", label: "Rawファイル一覧", en: "Raw file list" },
  { id: "sheet", label: "サンプルシート", en: "Sample sheet" },
  { id: "rename", label: "ファイル名変更", en: "Rename" },
];

export default function OrganizePage() {
  const [tab, setTab] = useState<Tab>("files");
  const ws = useWorkspace();

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold text-ink">データ整理 / Data organization</h1>
        <p className="mt-1 text-sm text-ink-2">
          Build a raw file inventory, derive a sample sheet, and plan a safe batch rename.
          Everything runs in your browser.
        </p>
      </header>

      <div role="tablist" aria-label="Data organization steps" className="scroll-x flex gap-1 border-b border-line">
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
            <span className="ml-1.5 text-xs text-ink-3">{t.en}</span>
          </button>
        ))}
      </div>

      {tab === "files" && <RawFilesPanel />}
      {tab === "sheet" && <SampleSheetPanel />}
      {tab === "rename" && <RenamePanel />}

      {ws.clips.length > 0 && (
        <Callout tone="good" title={`${ws.clips.length} block(s) queued for the notebook`}>
          Open the <a className="underline" href="/notebook">実験ノート / Notebook</a> tab to assemble them.
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
        title="ファイルを追加 / Add files"
        subtitle="Pick files, pick a folder, or paste a list of names. Files are read for name and size only — contents never leave your machine."
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => fileInput.current?.click()}>
              ファイル選択 / Choose files
            </Button>
            <Button onClick={() => dirInput.current?.click()}>
              フォルダ選択 / Choose folder
            </Button>
            {ws.files.length > 0 && (
              <Button
                variant="danger"
                onClick={() => {
                  ws.setFiles([]);
                  ws.setInventory(null);
                }}
              >
                クリア / Clear ({ws.files.length})
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
            label="または名前を貼り付け / Or paste filenames (one per line)"
            hint="Useful when the files live on an instrument PC you cannot browse from here."
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
              追加 / Add pasted names
            </Button>
          </div>
        </div>
      </Card>

      {!inventory && <EmptyState title="No files yet">Add files above to build the inventory.</EmptyState>}

      {inventory && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Files" value={inventory.entries.length} />
            <StatTile label="Total size" value={humanSize(inventory.totalSize) || "—"} />
            <StatTile label="File types" value={inventory.extensions.length} />
            <StatTile
              label="Issues"
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
            title="ファイル一覧 / File inventory"
            subtitle={`${shown.length} of ${inventory.entries.length} shown`}
            actions={
              <>
                <TextInput
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter…"
                  className="w-40"
                  aria-label="Filter files"
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
                  onClick={() => ws.addClip("Raw file inventory", inventoryToMarkdown(inventory))}
                >
                  ノートへ / To notebook
                </Button>
              </>
            }
          >
            <DataTable
              maxHeight="30rem"
              headers={["#", "File", "Type", "Size", "Group", "Rep", "Order", "Issues"]}
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
            <Card title="推定グループ / Inferred groups" subtitle="Guessed from filename tokens; correct them on the sample sheet tab.">
              <DataTable
                headers={["Group", "Files", "Example"]}
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
      <EmptyState title="No sample sheet yet">
        Add raw files on the first tab, and a sample sheet is proposed automatically.
      </EmptyState>
    );
  }

  const errors = sheet.issues.filter((i) => i.level === "error");
  const warnings = sheet.issues.filter((i) => i.level === "warning");
  const table = sampleSheetToTable(sheet);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Samples" value={sheet.rows.length} />
        <StatTile label="Groups" value={sheet.groups.length} />
        <StatTile label="Errors" value={errors.length} tone={errors.length ? "danger" : "good"} />
        <StatTile label="Warnings" value={warnings.length} tone={warnings.length ? "warn" : "good"} />
      </div>

      {errors.length > 0 && (
        <Callout tone="danger" title="Fix before analysing">
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {errors.map((e, i) => (
              <li key={i}>{e.row !== null ? `Row ${e.row + 1}: ` : ""}{e.message}</li>
            ))}
          </ul>
        </Callout>
      )}
      {warnings.length > 0 && (
        <Callout tone="warn" title="Worth checking">
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {warnings.map((e, i) => (
              <li key={i}>{e.row !== null ? `Row ${e.row + 1}: ` : ""}{e.message}</li>
            ))}
          </ul>
        </Callout>
      )}

      <Card
        title="サンプルシート / Sample sheet"
        subtitle="Edit any cell. Groups drive every downstream comparison."
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
            <Button size="sm" onClick={() => ws.addClip("Sample sheet", sampleSheetToMarkdown(sheet))}>
              ノートへ / To notebook
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => ws.setSheet(sheet)}
              disabled={!sheet.valid}
              title={sheet.valid ? "" : "Resolve errors first"}
            >
              確定 / Use this sheet
            </Button>
          </>
        }
      >
        <div className="scroll-x rounded-lg border border-line">
          <table className="w-full border-collapse text-xs">
            <thead className="bg-surface-2">
              <tr>
                {["Sample ID", "File", "Group", "Rep", "Batch", "Order"].map((h) => (
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

      <Card title="群の構成 / Group composition">
        <DataTable
          headers={["Group", "n", "Status"]}
          align={["left", "right", "left"]}
          rows={sheet.groups.map((g) => [
            g.name,
            g.n,
            g.n >= 3
              ? <Badge key="s" tone="good">OK</Badge>
              : g.n === 2
                ? <Badge key="s" tone="warn">n=2, unstable</Badge>
                : <Badge key="s" tone="danger">needs ≥2</Badge>,
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
    return <EmptyState title="No files loaded">Add files on the first tab to plan a rename.</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="変更ルール / Rename rules"
        subtitle="Extensions are always preserved. Nothing is written to disk — export the mapping and apply it with your own script."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="プリセット / Preset" hint={RENAME_PRESETS.find((p) => p.id === presetId)?.description}>
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
            <Field label="検索 / Find">
              <TextInput value={find} onChange={(e) => setFind(e.target.value)} placeholder="old text" />
            </Field>
            <Field label="置換 / Replace with">
              <TextInput value={replaceWith} onChange={(e) => setReplaceWith(e.target.value)} placeholder="new text" />
            </Field>
          </div>
        </div>
      </Card>

      {preview && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Files" value={preview.rows.length} />
            <StatTile label="Renamed" value={preview.changedCount} tone="accent" />
            <StatTile
              label="Collisions"
              value={preview.collisions.length}
              tone={preview.collisions.length ? "danger" : "good"}
            />
            <StatTile
              label="Safe to apply"
              value={preview.safe ? "Yes" : "No"}
              tone={preview.safe ? "good" : "danger"}
            />
          </div>

          {preview.issues.map((m, i) => (
            <Callout key={i} tone={preview.safe ? "warn" : "danger"}>{m}</Callout>
          ))}

          <Card
            title="プレビュー / Preview"
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
                  マッピングCSV / Mapping CSV
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    const map = previewToMapping(preview);
                    const ps = [
                      "# PowerShell — review before running",
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
                  スクリプト / Script
                </Button>
                <Button size="sm" onClick={() => ws.addClip("File rename", renameToMarkdown(preview))}>
                  ノートへ / To notebook
                </Button>
              </>
            }
          >
            <DataTable
              maxHeight="28rem"
              headers={["Before", "After", ""]}
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
                  <Badge key="c" tone="good">changed</Badge>
                ) : (
                  <span key="c" className="text-ink-3">unchanged</span>
                ),
              ])}
            />
          </Card>
        </>
      )}
    </div>
  );
}
