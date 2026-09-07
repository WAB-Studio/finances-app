import { LOOKUP_SCHEMA, type LookupRecord } from "./types";

// A separate database from `reading-dictionary`: an IndexedDB transaction is
// scoped to one database, so a write here never queues behind a read of the
// 8.2 MB payload (RNL-06).
const DATABASE_NAME = "reading-log";
const DATABASE_VERSION = 1;
const STORE_NAME = "lookups";

// The box is quiet this long before a query counts as settled, and a settled
// row waits no longer than this before it is written even if the chain keeps
// extending.
const SETTLE_MS = 800;
const MAX_PENDING_MS = 5000;

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("indexedDB unavailable"));
  }
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE_NAME, {
        keyPath: "id",
        autoIncrement: true,
      });
      store.createIndex("at", "at");
      store.createIndex("normalised", "normalised");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  // Forget a connection that dies (deleted database, version change
  // elsewhere) so the next write reopens instead of retrying a dead handle.
  databasePromise.catch(() => {
    databasePromise = null;
  });
  return databasePromise;
}

async function writeRow(row: LookupRecord): Promise<void> {
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).add(row);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch {
    // A caller learns nothing about whether a write succeeded, by design.
    databasePromise = null;
  }
}

function commit(row: LookupRecord): void {
  void writeRow(row);
}

function isStrictPrefix(previous: string, next: string): boolean {
  return next !== previous && next.startsWith(previous);
}

// The one pending row this module ever holds, and the timers that govern it.
let pending: LookupRecord | null = null;
let latestCandidate: LookupRecord | null = null;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let maxPendingTimer: ReturnType<typeof setTimeout> | null = null;

// Folds the most recent, not-yet-settled call into `pending`: merges it into
// a same-word chain, or commits the displaced row and starts a new chain.
function settleCandidate(): void {
  const candidate = latestCandidate;
  latestCandidate = null;
  if (!candidate) return;
  if (pending && isStrictPrefix(pending.normalised, candidate.normalised)) {
    pending = candidate;
    return;
  }
  if (pending) commit(pending);
  if (maxPendingTimer) clearTimeout(maxPendingTimer);
  pending = candidate;
  maxPendingTimer = setTimeout(flushPendingLookup, MAX_PENDING_MS);
}

function onSettleTimer(): void {
  settleTimer = null;
  settleCandidate();
}

/**
 * Buffers one keystroke's answer. Returns `void`, never a promise, so no
 * caller can put a write on the path that produces an answer (RNL-06). The
 * guard below decides whether and when this ever reaches IndexedDB.
 */
export function recordLookup(row: Omit<LookupRecord, "id" | "schema">): void {
  latestCandidate = { ...row, schema: LOOKUP_SCHEMA };
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(onSettleTimer, SETTLE_MS);
}

/**
 * Forces the pending row to IndexedDB now. Call this when the box empties:
 * the guard has no other way to learn a query was abandoned mid-word. Also
 * fires on tab hide and page hide, so a killed tab loses at most one row.
 */
export function flushPendingLookup(): void {
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  settleCandidate();
  if (maxPendingTimer) {
    clearTimeout(maxPendingTimer);
    maxPendingTimer = null;
  }
  if (pending) {
    commit(pending);
    pending = null;
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flushPendingLookup();
  });
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushPendingLookup);
}

// Written for the review engine; nothing in this slice calls either.

export async function countRecords(): Promise<number> {
  const database = await openDatabase();
  return new Promise<number>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readAll(): Promise<LookupRecord[]> {
  const database = await openDatabase();
  return new Promise<LookupRecord[]>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as LookupRecord[]);
    request.onerror = () => reject(request.error);
  });
}
