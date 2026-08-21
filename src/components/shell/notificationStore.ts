/**
 * Client-side notification inbox.
 *
 * Server notices (setup warnings, lab activity) arrive via /api/notifications.
 * Every toast is also recorded here so the bell dropdown is a complete history
 * of what the user was told — not only what the API knows about.
 *
 * Read state is local: opening the panel marks the current set as seen.
 */

import type { Notice, NoticeTone } from "@/app/api/notifications/route";

const NOTICES_KEY = "chondro.notifications";
const READ_KEY = "chondro.notifications.read";
const MAX_STORED = 50;

export type ToastNoticeInput = {
  tone: NoticeTone;
  title: string;
  detail: string;
  href?: string | null;
};

let clientNotices: Notice[] = [];
let readIds = new Set<string>();
let hydrated = false;
const listeners = new Set<() => void>();

const EMPTY_NOTICES: Notice[] = [];
const EMPTY_READ: ReadonlySet<string> = new Set();

function emit(): void {
  for (const l of listeners) l();
}

function persistNotices(): void {
  try {
    localStorage.setItem(NOTICES_KEY, JSON.stringify(clientNotices));
  } catch {
    // Persistence is a convenience; the in-memory list still works.
  }
}

function persistRead(): void {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...readIds]));
  } catch {
    // Same as above.
  }
}

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(NOTICES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Notice[];
      if (Array.isArray(parsed)) clientNotices = parsed.slice(0, MAX_STORED);
    }
  } catch {
    clientNotices = [];
  }
  try {
    const raw = localStorage.getItem(READ_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed)) readIds = new Set(parsed);
    }
  } catch {
    readIds = new Set();
  }
}

export function subscribeNotifications(listener: () => void): () => void {
  hydrate();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getClientNotices(): Notice[] {
  hydrate();
  return clientNotices;
}

export function getClientNoticesServer(): Notice[] {
  return EMPTY_NOTICES;
}

export function getReadIds(): ReadonlySet<string> {
  hydrate();
  return readIds;
}

export function getReadIdsServer(): ReadonlySet<string> {
  return EMPTY_READ;
}

/** Record a toast (or any transient event) so it appears in the bell list. */
export function pushClientNotice(input: ToastNoticeInput): Notice {
  hydrate();
  const notice: Notice = {
    id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    tone: input.tone,
    title: input.title,
    detail: input.detail,
    at: new Date().toISOString(),
    href: input.href ?? null,
  };
  clientNotices = [notice, ...clientNotices].slice(0, MAX_STORED);
  persistNotices();
  emit();
  return notice;
}

/** Merge server + client notices, newest first when timestamps exist. */
export function mergeNotices(server: Notice[], client: Notice[]): Notice[] {
  const byId = new Map<string, Notice>();
  for (const n of server) byId.set(n.id, n);
  for (const n of client) {
    if (!byId.has(n.id)) byId.set(n.id, n);
  }
  return [...byId.values()].sort((a, b) => {
    if (a.at && b.at) return b.at.localeCompare(a.at);
    if (a.at) return -1;
    if (b.at) return 1;
    return 0;
  });
}

export function countUnread(notices: Notice[], read: ReadonlySet<string>): number {
  return notices.filter((n) => !read.has(n.id)).length;
}

/** Mark every currently listed notice as read (typical "opened the panel" UX). */
export function markNoticesRead(ids: string[]): void {
  hydrate();
  let changed = false;
  const next = new Set(readIds);
  for (const id of ids) {
    if (!next.has(id)) {
      next.add(id);
      changed = true;
    }
  }
  if (!changed) return;
  readIds = next;
  persistRead();
  emit();
}

export function clearClientNotices(): void {
  hydrate();
  clientNotices = [];
  persistNotices();
  emit();
}
