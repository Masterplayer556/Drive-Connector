// „Sieht gleich aus“: Abbilder der Fotos auf diesem Gerät sammeln (IndexedDB) und daraus Gruppen bilden.
// Gespeichert wird pro Prüfsumme (md5) – gleiche Datei = gleiches Abbild, egal in welchem Ordner oder Konto.
// Die Abbilder entstehen aus kleinen Vorschaubildern direkt von Google (wie die Kacheln im Drive).
import { groupLookalikes, signature, SOURCE, type Sig } from "./lookalike";
import { supabase } from "./supabase";
import { fetchThumbBlobs } from "./thumbSource";

const DB_NAME = "drivepool-look";
const STORE = "sig";
/** Vorschaugrösse fürs Abbild – immer dieselbe, damit die Abbilder vergleichbar bleiben */
const THUMB_SIZE = 96;
const BATCH = 40;
const PARALLEL = 2;
const STATE_KEY = "drivepool.look";

export interface LookState {
  /** Wann zuletzt ALLE Fotos geprüft wurden (ISO) */
  full: string | null;
  /** Bis wann neue Fotos schon geprüft sind (ISO) */
  upTo: string | null;
}

export function lookState(): LookState {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY) ?? "null");
    if (raw) return { full: raw.full ?? null, upTo: raw.upTo ?? null };
  } catch {
    /* ignorieren */
  }
  return { full: null, upTo: null };
}

function saveState(s: LookState) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(s));
  } catch {
    /* ignorieren */
  }
}

// ---- Speicher auf dem Gerät ----

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); // md5 → Sig
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB nicht verfügbar"));
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB-Fehler"));
  });
}

async function knownMd5s(): Promise<Set<string>> {
  const keys = await req((await db()).transaction(STORE).objectStore(STORE).getAllKeys());
  return new Set(keys as string[]);
}

async function putSigs(entries: [string, Sig][]) {
  if (!entries.length) return;
  const tx = (await db()).transaction(STORE, "readwrite");
  for (const [md5, sig] of entries) tx.objectStore(STORE).put(sig, md5);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("IndexedDB-Fehler"));
  });
}

async function deleteSigs(md5s: string[]) {
  if (!md5s.length) return;
  const tx = (await db()).transaction(STORE, "readwrite");
  for (const m of md5s) tx.objectStore(STORE).delete(m);
  await new Promise<void>((resolve) => (tx.oncomplete = tx.onerror = tx.onabort = () => resolve()));
}

async function allSigs(): Promise<{ id: string; sig: Sig }[]> {
  const store = (await db()).transaction(STORE).objectStore(STORE);
  const [keys, values] = await Promise.all([req(store.getAllKeys()), req(store.getAll())]);
  return (keys as string[]).map((id, i) => ({ id, sig: values[i] as Sig }));
}

/** Wie viele Fotos sind auf diesem Gerät schon geprüft? */
export async function lookCount(): Promise<number> {
  try {
    return await req((await db()).transaction(STORE).objectStore(STORE).count());
  } catch {
    return 0;
  }
}

/** Alles vergessen (z. B. vor „Alles neu prüfen“). */
export async function clearLook() {
  const tx = (await db()).transaction(STORE, "readwrite");
  tx.objectStore(STORE).clear();
  await new Promise<void>((resolve) => (tx.oncomplete = tx.onerror = tx.onabort = () => resolve()));
  saveState({ full: null, upTo: null });
}

// ---- Abbild aus einem Vorschaubild ----

let canvas: HTMLCanvasElement | null = null;

/** Abbild eines Bildes (null = lässt sich nicht lesen). */
export async function sigFromBlob(blob: Blob): Promise<Sig | null> {
  let bmp: ImageBitmap | HTMLImageElement;
  let url: string | null = null;
  try {
    if ("createImageBitmap" in window) bmp = await createImageBitmap(blob);
    else {
      url = URL.createObjectURL(blob);
      const img = new Image();
      img.src = url;
      await img.decode();
      bmp = img;
    }
  } catch {
    if (url) URL.revokeObjectURL(url);
    return null;
  }
  try {
    const w = "naturalWidth" in bmp ? bmp.naturalWidth : bmp.width;
    const h = "naturalHeight" in bmp ? bmp.naturalHeight : bmp.height;
    if (!w || !h) return null;
    canvas ??= document.createElement("canvas");
    canvas.width = canvas.height = SOURCE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    // Durchsichtiges zählt als Weiss
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, SOURCE, SOURCE);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, SOURCE, SOURCE);
    return signature(ctx.getImageData(0, 0, SOURCE, SOURCE).data, w / h);
  } catch {
    return null;
  } finally {
    if ("close" in bmp) bmp.close();
    if (url) URL.revokeObjectURL(url);
  }
}

// ---- Prüfen ----

interface Row {
  account_id: string;
  drive_id: string;
  parent_drive_id: string | null;
  md5: string | null;
}

/** Alle Bilder im Pool (schlank: nur was zum Laden der Vorschau nötig ist). `since` = nur seither neu dazugekommene. */
async function imageRows(since: string | null): Promise<Row[]> {
  const out: Row[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from("items")
      .select("account_id,drive_id,parent_drive_id,md5")
      .eq("is_folder", false)
      .not("path", "is", null)
      .not("md5", "is", null)
      .like("mime_type", "image/%");
    if (since) q = q.gt("created_time", since);
    const { data, error } = await q.order("account_id").order("drive_id").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) return out;
  }
}

export interface ScanProgress {
  done: number;
  total: number;
}

/**
 * Fotos prüfen, die noch kein Abbild haben. `full` = alle Fotos durchgehen (sonst nur seit dem letzten Mal neue).
 * Bricht `signal` ab, bleibt das bisher Geprüfte erhalten – der nächste Lauf macht weiter.
 * Ergebnis: wie viele Fotos neu geprüft wurden.
 */
export async function scanLook({
  full,
  onProgress,
  signal,
}: {
  full: boolean;
  onProgress?: (p: ScanProgress) => void;
  signal?: AbortSignal;
}): Promise<number> {
  const started = new Date();
  const state = lookState();
  // Etwas Überlappung: ein Foto kann kurz vor dem letzten Lauf hochgeladen, aber erst danach eingelesen worden sein
  const since = !full && state.upTo ? new Date(Date.parse(state.upTo) - 2 * 24 * 3600_000).toISOString() : null;
  const [rows, known] = await Promise.all([imageRows(since), knownMd5s()]);

  // Pro Prüfsumme reicht ein Foto; nach Konto + Ordner bündeln (ein Aufruf holt die Vorschau-Links des Ordners)
  const todo = new Map<string, Row>();
  for (const r of rows) if (r.md5 && !known.has(r.md5) && !todo.has(r.md5)) todo.set(r.md5, r);
  const byFolder = new Map<string, Row[]>();
  for (const r of todo.values()) {
    const k = `${r.account_id}|${r.parent_drive_id ?? ""}`;
    const list = byFolder.get(k);
    if (list) list.push(r);
    else byFolder.set(k, [r]);
  }
  const batches: Row[][] = [];
  for (const list of byFolder.values()) for (let i = 0; i < list.length; i += BATCH) batches.push(list.slice(i, i + BATCH));

  const total = todo.size;
  let done = 0;
  let added = 0;
  onProgress?.({ done, total });
  const worker = async () => {
    for (let batch = batches.shift(); batch && !signal?.aborted; batch = batches.shift()) {
      try {
        const first = batch[0];
        const blobs = await fetchThumbBlobs(first.account_id, first.parent_drive_id, batch.map((b) => b.drive_id), THUMB_SIZE, {
          timeout: 45_000,
        });
        const sigs: [string, Sig][] = [];
        for (const r of batch) {
          const blob = blobs.get(r.drive_id);
          const sig = blob ? await sigFromBlob(blob) : null;
          if (sig) sigs.push([r.md5!, sig]);
        }
        await putSigs(sigs);
        added += sigs.length;
      } catch {
        /* Konto nicht erreichbar o. ä. → beim nächsten Lauf nochmals */
      }
      done += batch.length;
      onProgress?.({ done, total });
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  if (!signal?.aborted) {
    if (full) {
      // Abbilder von Fotos, die es nicht mehr gibt, wegräumen
      const alive = new Set(rows.map((r) => r.md5));
      await deleteSigs([...known].filter((m) => !alive.has(m)));
    }
    saveState({ full: full ? started.toISOString() : state.full, upTo: started.toISOString() });
  }
  return added;
}

/** Gruppen gleich aussehender Fotos als Listen von Prüfsummen (jede Gruppe: mindestens 2 verschiedene Dateien). */
export async function lookGroups(): Promise<string[][]> {
  const pause = () => new Promise<void>((r) => setTimeout(r, 0));
  return groupLookalikes(await allSigs(), pause);
}
