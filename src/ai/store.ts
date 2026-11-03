// KI-SUCHE (Test): Index nur auf diesem Gerät (IndexedDB). Nichts davon geht an Supabase oder Google.
import { INDEX_VERSION } from "./protocol";

const DB_NAME = "drivepool-ai";
/** Cache, in dem transformers.js die Modelldateien ablegt. */
export const MODEL_CACHE = "transformers-cache";

/** Schlüssel eines Fotos: Konto + Drive-ID. */
export const itemKey = (it: { account_id: string; drive_id: string }) => `${it.account_id}/${it.drive_id}`;

let dbPromise: Promise<IDBDatabase> | null = null;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB-Fehler"));
  });
}

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore("vectors"); // Schlüssel → Float32Array
      db.createObjectStore("skip"); // Schlüssel → Zeitpunkt (kein Vorschaubild o. ä.)
      db.createObjectStore("meta");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB nicht verfügbar"));
  }).then(async (db) => {
    // Anderes Modell → alter Index passt nicht mehr
    const version = await req(db.transaction("meta").objectStore("meta").get("version"));
    if (version !== INDEX_VERSION) {
      const tx = db.transaction(["vectors", "skip", "meta"], "readwrite");
      tx.objectStore("vectors").clear();
      tx.objectStore("skip").clear();
      tx.objectStore("meta").put(INDEX_VERSION, "version");
      await new Promise((res) => (tx.oncomplete = res));
    }
    return db;
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

export async function putVector(key: string, vec: Float32Array) {
  const db = await open();
  await req(db.transaction("vectors", "readwrite").objectStore("vectors").put(vec, key));
}

export async function markSkip(key: string) {
  const db = await open();
  await req(db.transaction("skip", "readwrite").objectStore("skip").put(Date.now(), key));
}

export async function allVectors(): Promise<Map<string, Float32Array>> {
  const db = await open();
  const store = db.transaction("vectors").objectStore("vectors");
  const [keys, values] = await Promise.all([req(store.getAllKeys()), req(store.getAll())]);
  return new Map(keys.map((k, i) => [String(k), values[i] as Float32Array]));
}

export async function vectorKeys(): Promise<Set<string>> {
  const db = await open();
  return new Set((await req(db.transaction("vectors").objectStore("vectors").getAllKeys())).map(String));
}

export async function skipped(): Promise<Map<string, number>> {
  const db = await open();
  const store = db.transaction("skip").objectStore("skip");
  const [keys, values] = await Promise.all([req(store.getAllKeys()), req(store.getAll())]);
  return new Map(keys.map((k, i) => [String(k), values[i] as number]));
}

export async function removeKeys(keys: string[]) {
  if (!keys.length) return;
  const db = await open();
  const tx = db.transaction(["vectors", "skip"], "readwrite");
  for (const k of keys) {
    tx.objectStore("vectors").delete(k);
    tx.objectStore("skip").delete(k);
  }
  await new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}

/** Index und heruntergeladene Modelle komplett vom Gerät löschen. */
export async function wipeEverything(): Promise<void> {
  const db = await dbPromise?.catch(() => null);
  db?.close();
  dbPromise = null;
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
  if (!("caches" in window)) return;
  await caches.delete(MODEL_CACHE).catch(() => false);
  // KI-Laufzeit (ort-wasm…) aus dem App-Cache des Service Workers entfernen
  for (const name of await caches.keys().catch(() => [] as string[])) {
    if (!name.startsWith("drive-pool-")) continue;
    const cache = await caches.open(name);
    for (const r of await cache.keys()) if (/ort-wasm|\/worker-/.test(r.url)) await cache.delete(r);
  }
}

/** Wie viel Platz belegen Modelle + Index ungefähr? */
export async function usedBytes(): Promise<number | null> {
  if (!("caches" in window)) return null;
  try {
    const cache = await caches.open(MODEL_CACHE);
    let sum = 0;
    for (const r of await cache.keys()) {
      const res = await cache.match(r);
      const len = Number(res?.headers.get("content-length"));
      if (Number.isFinite(len) && len > 0) sum += len;
    }
    const n = (await vectorKeys().catch(() => new Set())).size;
    return sum + n * 512 * 4;
  } catch {
    return null;
  }
}
