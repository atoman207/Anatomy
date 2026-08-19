/**
 * Light / dark appearance, persisted across visits.
 *
 * Same module-level store as sidebarPreference: state lives outside React so
 * the header button and the document attribute stay in lockstep without an
 * effect-driven second render on mount.
 */

export type Theme = "light" | "dark";

const KEY = "chondro.theme";

let theme: Theme = "light";
let hydrated = false;
const listeners = new Set<() => void>();

function apply(next: Theme): void {
  document.documentElement.setAttribute("data-theme", next);
}

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "dark" || stored === "light") theme = stored;
  } catch {
    // Private mode or blocked storage; the default stands.
  }
  apply(theme);
}

export function subscribeTheme(listener: () => void): () => void {
  hydrate();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTheme(): Theme {
  return theme;
}

/** The server has no localStorage, so it always renders light. */
export function getThemeServer(): Theme {
  return "light";
}

export function setTheme(next: Theme): void {
  theme = next;
  apply(next);
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Persisting is a convenience, not a requirement.
  }
  for (const l of listeners) l();
}

export function toggleTheme(): void {
  setTheme(theme === "dark" ? "light" : "dark");
}
