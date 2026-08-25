"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { Button, Callout, Card, EmptyState, cx } from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import {
  deleteSubmissionFile, getMySubmissionUploadUsage, listSubmissionFiles, uploadSubmissionFile,
  type SubmissionFileSummary,
} from "@/lib/submissionFiles/actions";
import {
  formatBytes, MAX_DAILY_SUBMISSION_UPLOAD_BYTES, SUBMISSION_FILE_KINDS, SUBMISSION_FILE_LABELS,
  type SubmissionFileKind,
} from "@/lib/submissionFiles/shared";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("読み込みに失敗しました。"));
    reader.readAsDataURL(file);
  });
}

/**
 * Figure / Table / Video / Article - kept separate from the notebook's
 * inline images on purpose: most journals require these as distinct files
 * at submission time, not embedded in the manuscript text, so this section
 * never inserts anything into the report body (see the migration for the
 * fuller rationale). Scoped to the experiment as a whole, not to one day's
 * entry, so it stays reachable regardless of the notebook step's phase.
 */
export function SubmissionFilesManager({
  labId, experimentId,
}: {
  labId: string | null;
  experimentId: string | null;
}) {
  const { toast } = useToast();
  const fileInputs = useRef<Partial<Record<SubmissionFileKind, HTMLInputElement | null>>>({});

  const [files, setFiles] = useState<SubmissionFileSummary[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [usedBytes, setUsedBytes] = useState<number | null>(null);
  const [uploading, setUploading] = useState<SubmissionFileKind | null>(null);
  const [dragOver, setDragOver] = useState<SubmissionFileKind | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const refreshUsage = useCallback(async () => {
    const res = await getMySubmissionUploadUsage();
    if (res.ok && res.data) setUsedBytes(res.data.usedBytes);
  }, []);

  useEffect(() => {
    getMySubmissionUploadUsage().then((res) => {
      if (res.ok && res.data) setUsedBytes(res.data.usedBytes);
    });
  }, []);

  useEffect(() => {
    if (!experimentId || experimentId === loadedFor) return;
    listSubmissionFiles(experimentId).then((res) => {
      if (res.ok && res.data) setFiles(res.data);
      setLoadedFor(experimentId);
    });
  }, [experimentId, loadedFor]);

  async function upload(kind: SubmissionFileKind, file: File | undefined) {
    if (!file || !labId || !experimentId) return;
    setUploading(kind);
    try {
      const base64 = await fileToBase64(file);
      const res = await uploadSubmissionFile({
        labId, experimentId, kind, filename: file.name, mimeType: file.type || "application/octet-stream", base64,
      });
      if (!res.ok) {
        toast(res.error ?? "アップロードに失敗しました。", { tone: "danger", title: "エラー" });
        return;
      }
      toast(`${SUBMISSION_FILE_LABELS[kind].title}を追加しました。`, { tone: "good" });
      const refreshed = await listSubmissionFiles(experimentId);
      if (refreshed.ok && refreshed.data) setFiles(refreshed.data);
      void refreshUsage();
    } catch (e) {
      toast(e instanceof Error ? e.message : "アップロードに失敗しました。", { tone: "danger", title: "エラー" });
    } finally {
      setUploading(null);
    }
  }

  async function remove(id: string) {
    setDeleting(id);
    try {
      const res = await deleteSubmissionFile(id);
      if (!res.ok) {
        toast(res.error ?? "削除に失敗しました。", { tone: "danger" });
        return;
      }
      setFiles((prev) => prev.filter((f) => f.id !== id));
      void refreshUsage();
    } finally {
      setDeleting(null);
    }
  }

  function onDrop(kind: SubmissionFileKind, e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(null);
    void upload(kind, e.dataTransfer.files?.[0]);
  }

  if (!experimentId) return null;

  const remaining = usedBytes === null ? null : Math.max(0, MAX_DAILY_SUBMISSION_UPLOAD_BYTES - usedBytes);

  return (
    <Card
      title="投稿用ファイル（Figure・Table・Video・Article）"
      subtitle="多くのジャーナルは、図表・動画・原稿を本文とは別ファイルで提出する形式を求めます。ここでの追加はレポート本文には挿入されません。実験全体で共有されます。"
    >
      <div className="flex flex-col gap-4">
        {usedBytes !== null && (
          <div className="flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className={cx(
                  "h-full transition-[width]",
                  usedBytes >= MAX_DAILY_SUBMISSION_UPLOAD_BYTES ? "bg-danger" : "bg-accent",
                )}
                style={{ width: `${Math.min(100, (usedBytes / MAX_DAILY_SUBMISSION_UPLOAD_BYTES) * 100)}%` }}
              />
            </div>
            <span className="shrink-0 text-[11px] text-ink-3">
              本日 {formatBytes(usedBytes)} / {formatBytes(MAX_DAILY_SUBMISSION_UPLOAD_BYTES)}
            </span>
          </div>
        )}

        {remaining === 0 && (
          <Callout tone="warn" title="本日の上限に達しました">
            投稿用ファイルのアップロードは1日あたり{formatBytes(MAX_DAILY_SUBMISSION_UPLOAD_BYTES)}までです。日付が変わるとリセットされます。
          </Callout>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {SUBMISSION_FILE_KINDS.map((kind) => {
            const label = SUBMISSION_FILE_LABELS[kind];
            const busy = uploading === kind;
            return (
              <div
                key={kind}
                onDragOver={(e) => { e.preventDefault(); if (remaining !== 0) setDragOver(kind); }}
                onDragLeave={() => setDragOver((v) => (v === kind ? null : v))}
                onDrop={(e) => onDrop(kind, e)}
                className={cx(
                  "flex flex-col gap-1.5 rounded-lg border-2 border-dashed p-3 transition-colors",
                  dragOver === kind ? "border-accent bg-accent-soft" : "border-line",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-medium text-ink">{label.title}</p>
                    <p className="text-[11px] text-ink-3">{label.description}</p>
                  </div>
                  <Button
                    size="sm"
                    icon="upload"
                    disabled={busy || remaining === 0}
                    onClick={() => fileInputs.current[kind]?.click()}
                  >
                    {busy ? "アップロード中…" : "追加"}
                  </Button>
                  <input
                    ref={(el) => { fileInputs.current[kind] = el; }}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      void upload(kind, e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </div>

                <ul className="flex flex-col gap-1">
                  {files.filter((f) => f.kind === kind).length === 0 ? (
                    <li className="text-[11px] text-ink-3">まだファイルがありません。またはここにドラッグ＆ドロップ。</li>
                  ) : (
                    files
                      .filter((f) => f.kind === kind)
                      .map((f) => (
                        <li key={f.id} className="flex items-center justify-between gap-2 rounded-md border border-line px-2 py-1.5">
                          <div className="min-w-0">
                            {f.signedUrl ? (
                              <a
                                href={f.signedUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block truncate text-[12px] font-medium text-accent underline underline-offset-2"
                              >
                                {f.name}
                              </a>
                            ) : (
                              <span className="block truncate text-[12px] font-medium text-ink">{f.name}</span>
                            )}
                            <span className="text-[10px] text-ink-3">
                              {f.size_bytes !== null && `${formatBytes(f.size_bytes)} · `}
                              {new Date(f.created_at).toLocaleDateString("ja-JP")}
                            </span>
                          </div>
                          <Button
                            size="sm" variant="ghost" icon="trash"
                            aria-label={`${f.name}を削除`}
                            disabled={deleting === f.id}
                            onClick={() => void remove(f.id)}
                          />
                        </li>
                      ))
                  )}
                </ul>
              </div>
            );
          })}
        </div>

        {files.length === 0 && <EmptyState title="投稿用ファイルはまだありません" />}
      </div>
    </Card>
  );
}
