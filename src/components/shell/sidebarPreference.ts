/**
 * Whether the sidebar is collapsed, persisted across visits.
 *
 * Kept in a module-level store read through useSyncExternalStore rather than
 * in component state restored by an effect. An effect that synchronously sets
 * state costs a second render on every mount, and the server render has to
 * assume the expanded default anyway.
 */

const KEY = "chondro.sidebar.collapsed";

let collapsed = false;
let hydrated = false;
const listeners = new Set<() => void>();

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    collapsed = localStorage.getItem(KEY) === "1";
  } catch {
    // Private mode or blocked storage; the default stands.
  }
}

export function subscribeSidebar(listener: () => void): () => void {
  // The first subscriber triggers hydration; React re-reads the snapshot
  // immediately after subscribing, so the stored value lands in that commit.
  hydrate();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSidebarCollapsed(): boolean {
  return collapsed;
}

/** The server has no localStorage, so it always renders expanded. */
export function getSidebarCollapsedServer(): boolean {
  return false;
}

export function setSidebarCollapsed(next: boolean): void {
  collapsed = next;
  try {
    localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    // Persisting is a convenience, not a requirement.
  }
  for (const l of listeners) l();
}
