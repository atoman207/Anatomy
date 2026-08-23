"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { RawFileInput, RawFileInventory } from "@/lib/data/rawfiles";
import type { SampleSheet } from "@/lib/data/samplesheet";
import type { TableProfile } from "@/lib/data/table";
import type { DataMatrix } from "@/lib/stats/matrix";

export interface LoadedDataset {
  name: string;
  sourceFilename: string | null;
  sourceSheet: string | null;
  matrix: DataMatrix;
  profile: TableProfile | null;
  headers: string[];
  notes: string[];
}

export interface WorkspaceClip {
  id: string;
  title: string;
  markdown: string;
  createdAt: string;
  /** Optional template field values (e.g. from a structured voice memo). */
  prefill?: Record<string, string | string[] | number | null | undefined>;
}

export interface WorkspaceState {
  files: RawFileInput[];
  inventory: RawFileInventory | null;
  sheet: SampleSheet | null;
  dataset: LoadedDataset | null;
  /** Markdown blocks queued for the notebook. */
  clips: WorkspaceClip[];
  /**
   * The experiment every save-to-database action targets. Chosen once with
   * the ExperimentPicker and shared across every tool, so a researcher does
   * not have to re-select it on every page.
   */
  experimentId: string | null;
  labId: string | null;
  experimentLabel: string | null;
}

const EMPTY: WorkspaceState = {
  files: [],
  inventory: null,
  sheet: null,
  dataset: null,
  clips: [],
  experimentId: null,
  labId: null,
  experimentLabel: null,
};

const STORAGE_KEY = "chondro.workspace.v1";
/** sessionStorage tops out around 5 MB; stay well clear of it. */
const MAX_PERSIST_BYTES = 2_000_000;

/*
 * The workspace lives in a module-level store read through
 * useSyncExternalStore rather than in component state.
 *
 * That keeps restoring from sessionStorage out of an effect: an effect that
 * synchronously sets state causes a second render pass on every mount, and
 * the server render would still have to match the empty state anyway.
 */
let state: WorkspaceState = EMPTY;
let hydrated = false;
const listeners = new Set<() => void>();

function persist(): void {
  try {
    const json = JSON.stringify(state);
    if (json.length > MAX_PERSIST_BYTES) {
      // Keep the small parts; a large matrix stays in memory for this tab only.
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, dataset: null }));
    } else {
      sessionStorage.setItem(STORAGE_KEY, json);
    }
  } catch {
    // Quota exhaustion or private mode is not worth interrupting the user.
  }
}

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) state = { ...EMPTY, ...(JSON.parse(raw) as WorkspaceState) };
  } catch {
    // Corrupted storage just means we start fresh.
  }
}

function subscribe(listener: () => void): () => void {
  // First subscriber triggers hydration; React re-reads the snapshot straight
  // after subscribing, so the restored value lands in the same commit.
  hydrate();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): WorkspaceState {
  return state;
}

/** The server has no sessionStorage, so it always renders the empty workspace. */
function getServerSnapshot(): WorkspaceState {
  return EMPTY;
}

function update(patch: Partial<WorkspaceState> | ((s: WorkspaceState) => WorkspaceState)): void {
  state = typeof patch === "function" ? patch(state) : { ...state, ...patch };
  persist();
  for (const l of listeners) l();
}

export interface WorkspaceApi extends WorkspaceState {
  setFiles: (f: RawFileInput[]) => void;
  setInventory: (i: RawFileInventory | null) => void;
  setSheet: (s: SampleSheet | null) => void;
  setDataset: (d: LoadedDataset | null) => void;
  addClip: (title: string, markdown: string, prefill?: WorkspaceClip["prefill"]) => void;
  removeClip: (id: string) => void;
  clearClips: () => void;
  setExperiment: (v: { experimentId: string | null; labId: string | null; label: string | null }) => void;
  reset: () => void;
}

export function useWorkspace(): WorkspaceApi {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return useMemo<WorkspaceApi>(
    () => ({
      ...snapshot,
      setFiles: (files) => update({ files }),
      setInventory: (inventory) => update({ inventory }),
      setSheet: (sheet) => update({ sheet }),
      setDataset: (dataset) => update({ dataset }),
      addClip: (title, markdown, prefill) =>
        update((s) => ({
          ...s,
          clips: [
            ...s.clips,
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              title,
              markdown,
              createdAt: new Date().toISOString(),
              ...(prefill ? { prefill } : {}),
            },
          ],
        })),
      removeClip: (id) => update((s) => ({ ...s, clips: s.clips.filter((c) => c.id !== id) })),
      clearClips: () => update((s) => ({ ...s, clips: [] })),
      setExperiment: ({ experimentId, labId, label }) =>
        update({ experimentId, labId, experimentLabel: label }),
      reset: () => update(() => EMPTY),
    }),
    [snapshot],
  );
}

/**
 * Kept so the provider can stay in the tree as a no-op: the store is global,
 * but wrapping the app documents where workspace state belongs.
 */
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/** Triggers a client-side file download without leaving the page. */
export function useDownload() {
  return useCallback((filename: string, content: string | Blob, mime = "text/plain") => {
    const blob =
      content instanceof Blob
        ? content
        : new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on a later tick so the download has already started.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);
}
