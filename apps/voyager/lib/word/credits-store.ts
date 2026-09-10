import type { WordPhoto } from "./protocol";

// Its own database, isolated from `reading-log`: a credit is metadata about
// a photo already shown, never a lookup a sync or a deck reads.

export type Credit = {
  headword: string;
  author: string;
  // The bare code `/api/word/photo` emits, not a display name: `account.info.photoLicence`
  // is what turns `by-sa` into "CC BY-SA", and it does that at render time.
  licence: WordPhoto["licence"];
  licenceUrl: string;
  sourceUrl: string;
  at: number; // Date.now(), when the photo resolved
};

const DATABASE_NAME = "reading-credits";
const DATABASE_VERSION = 1;
const STORE_NAME = "credits";

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("indexedDB unavailable"));
  }
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "headword" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  // Forget a connection that dies so the next call reopens instead of
  // retrying a promise that can only ever reject again.
  databasePromise.catch(() => {
    databasePromise = null;
  });
  return databasePromise;
}

// `put`, not `add`: a headword resolved twice keeps its latest photo, not
// its first — the store names one credit per file, not per lookup.
//
// Never rejects: a credit that fails to save must never turn into a failed
// response for the photo it describes.
export async function rememberCredit(credit: Credit): Promise<void> {
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(credit);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch {
    // Swallowed by design; see above.
  }
}

export async function readCredits(): Promise<Credit[]> {
  try {
    const database = await openDatabase();
    const credits = await new Promise<Credit[]>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as Credit[]);
      request.onerror = () => reject(request.error);
    });
    return credits.sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}
