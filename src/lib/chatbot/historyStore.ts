/**
 * Assistant chatbot history, persisted in the browser's IndexedDB.
 *
 * Every turn is written as soon as it exists, so a reload, a closed tab or a
 * navigation between the landing page and the app never loses the
 * conversation. History is partitioned by `scope` (the signed-in account, or
 * "guest") and `mode` (voice / video), so a shared computer does not show one
 * person's conversation to the next.
 *
 * All functions degrade to no-ops when IndexedDB is unavailable (private
 * windows in some browsers, SSR): the chat still works, it just forgets.
 */

export interface StoredChatMessage {
  id: string;
  scope: string;
  mode: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

const DB_NAME = "labnote-assistant";
const DB_VERSION = 1;
const STORE = "messages";
const BY_THREAD = "byThread";
/** Oldest turns beyond this are pruned so the store cannot grow forever. */
export const MAX_STORED_PER_THREAD = 500;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex(BY_THREAD, ["scope", "mode", "createdAt"]);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading the schema must not be blocked by this one.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function threadRange(scope: string, mode: string): IDBKeyRange {
  return IDBKeyRange.bound([scope, mode, -Infinity], [scope, mode, Infinity]);
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

/** The thread's messages, oldest first. */
export async function loadChatHistory(scope: string, mode: string): Promise<StoredChatMessage[]> {
  const db = await openDb();
  if (!db) return [];
  try {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).index(BY_THREAD).getAll(threadRange(scope, mode));
    return await new Promise((resolve) => {
      req.onsuccess = () => resolve((req.result as StoredChatMessage[]) ?? []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function appendChatMessage(message: StoredChatMessage): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.put(message);

    // Prune the oldest turns once the thread exceeds the cap.
    const countReq = store.index(BY_THREAD).count(threadRange(message.scope, message.mode));
    countReq.onsuccess = () => {
      let excess = countReq.result - MAX_STORED_PER_THREAD;
      if (excess <= 0) return;
      const cursorReq = store.index(BY_THREAD).openCursor(threadRange(message.scope, message.mode));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || excess <= 0) return;
        cursor.delete();
        excess--;
        cursor.continue();
      };
    };
    await done(tx);
  } catch {
    /* storage full / blocked - the in-memory conversation continues */
  }
}

export async function clearChatHistory(scope: string, mode: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    const cursorReq = tx.objectStore(STORE).index(BY_THREAD).openKeyCursor(threadRange(scope, mode));
    const store = tx.objectStore(STORE);
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
    await done(tx);
  } catch {
    /* noop */
  }
}
