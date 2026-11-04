// KI-SUCHE (Test): Index nur auf diesem Gerät (IndexedDB). Nichts davon geht an Supabase oder Google.
import { aiModel } from "./flag";
import { MODELS, type ModelId, type ModelSpec } from "./protocol";

/** Cache, in dem transformers.js die Modelldateien ablegt. */
export const MODEL_CACHE = "transformers-cache";

/** Schlüssel eines Fotos: Konto + Drive-ID. */
export const itemKey = (it: { account_id: string; drive_id: string }) => `${it.account_id}/${it.drive_id}`;

// Pro Modell eine eigene Datenbank (Fingerabdrücke verschiedener Modelle passen nicht zusammen).
// 👍/👎 und Namen liegen immer in der Datenbank des Standardmodells – sie gelten für jedes Modell.
const dbs = new Map<string, Promise<IDBDatabase>>();

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB-Fehler"));
  });
}

function openDb(spec: ModelSpec): Promise<IDBDatabase> {
  let p = dbs.get(spec.db);
  if (p) return p;
  p = new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(spec.db, 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      const has = (n: string) => db.objectStoreNames.contains(n);
      if (!has("vectors")) db.createObjectStore("vectors"); // Schlüssel → Float32Array
      if (!has("skip")) db.createObjectStore("skip"); // Schlüssel → { at, n } (kein Vorschaubild o. ä.)
      if (!has("meta")) db.createObjectStore("meta");
      if (!has("feedback")) db.createObjectStore("feedback", { keyPath: "id" }); // 👍/👎 bei Treffern
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB nicht verfügbar"));
  }).then(async (db) => {
    // Andere Modellversion → alter Index passt nicht mehr
    const version = await req(db.transaction("meta").objectStore("meta").get("version"));
    if (version !== spec.version) {
      const tx = db.transaction(["vectors", "skip", "meta"], "readwrite");
      tx.objectStore("vectors").clear();
      tx.objectStore("skip").clear();
      tx.objectStore("meta").put(spec.version, "version");
      await new Promise((res) => (tx.oncomplete = res));
    }
    return db;
  });
  p.catch(() => dbs.delete(spec.db));
  dbs.set(spec.db, p);
  return p;
}

/** Datenbank des gewählten Modells (Index, Zwischenspeicher). */
const open = () => openDb(MODELS[aiModel()]);
/** Datenbank für 👍/👎 und Namen (immer die des Standardmodells). */
const openShared = () => openDb(MODELS.clip);

export async function putVector(key: string, vec: Float32Array) {
  const db = await open();
  await req(db.transaction("vectors", "readwrite").objectStore("vectors").put(vec, key));
}

/** Foto (noch) nicht lernbar, z. B. weil Google die Vorschau noch nicht fertig hat. Zählt die Versuche. */
export async function markSkip(key: string) {
  const db = await open();
  const store = db.transaction("skip", "readwrite").objectStore("skip");
  const old = (await req(store.get(key))) as Skip | number | undefined;
  const n = typeof old === "number" ? 3 : (old?.n ?? 0);
  await req(store.put({ at: Date.now(), n: n + 1 } satisfies Skip, key));
}

export interface Skip {
  at: number;
  /** Anzahl Fehlversuche */
  n: number;
}

export async function allVectors(model?: ModelId): Promise<Map<string, Float32Array>> {
  const db = await (model ? openDb(MODELS[model]) : open());
  const store = db.transaction("vectors").objectStore("vectors");
  const [keys, values] = await Promise.all([req(store.getAllKeys()), req(store.getAll())]);
  return new Map(keys.map((k, i) => [String(k), values[i] as Float32Array]));
}

export async function vectorKeys(): Promise<Set<string>> {
  const db = await open();
  return new Set((await req(db.transaction("vectors").objectStore("vectors").getAllKeys())).map(String));
}

export async function skipped(): Promise<Map<string, Skip>> {
  const db = await open();
  const store = db.transaction("skip").objectStore("skip");
  const [keys, values] = await Promise.all([req(store.getAllKeys()), req(store.getAll())]);
  // Ältere Einträge waren nur ein Zeitpunkt
  return new Map(keys.map((k, i) => [String(k), typeof values[i] === "number" ? { at: values[i] as number, n: 3 } : (values[i] as Skip)]));
}

/** 👍 (+1) oder 👎 (−1) zu einem Foto bei einer bestimmten Suche. */
export interface Feedback {
  /** Suche + Foto, z. B. "dog in the snow|konto/datei" */
  id: string;
  /** Vektor der Suche (damit ähnliche Suchen davon lernen) */
  q: Float32Array;
  english: string;
  key: string;
  vote: 1 | -1;
  at: number;
}

export async function allFeedback(): Promise<Feedback[]> {
  const db = await openShared();
  return (await req(db.transaction("feedback").objectStore("feedback").getAll())) as Feedback[];
}

export async function putFeedback(f: Feedback) {
  const db = await openShared();
  await req(db.transaction("feedback", "readwrite").objectStore("feedback").put(f));
}

export async function deleteFeedback(id: string) {
  const db = await openShared();
  await req(db.transaction("feedback", "readwrite").objectStore("feedback").delete(id));
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
  try {
    localStorage.removeItem("drivepool.ai.keepsim"); // bewusst behaltene „fast gleiche“ Gruppen
  } catch {
    /* ignorieren */
  }
  for (const spec of Object.values(MODELS)) {
    const db = await dbs.get(spec.db)?.catch(() => null);
    db?.close();
    dbs.delete(spec.db);
    await new Promise<void>((resolve) => {
      const r = indexedDB.deleteDatabase(spec.db);
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    });
  }
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

/** Kleiner Zwischenspeicher (z. B. Begriffe zum Trainieren) – gilt nur für das aktuelle Modell. */
export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await open();
  return (await req(db.transaction("meta").objectStore("meta").get(`${MODELS[aiModel()].version}|${key}`))) as T | undefined;
}

export async function putMeta(key: string, value: unknown) {
  const db = await open();
  await req(db.transaction("meta", "readwrite").objectStore("meta").put(value, `${MODELS[aiModel()].version}|${key}`));
}
