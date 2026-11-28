// „Sieht gleich aus“: Abbilder der Fotos sammeln und daraus Gruppen bilden.
//
// Die Abbilder liegen auf dem Server (Tabelle look_sigs, eines pro Prüfsumme) – jedes Foto wird nur einmal
// geprüft, egal auf welchem Gerät. Jedes Gerät hält eine Kopie in der IndexedDB (zum schnellen Vergleichen)
// und holt nur nach, was seit dem letzten Mal dazugekommen ist.
// Welche Fotos noch fehlen, sagt der Server (look_missing) – unabhängig vom Erstelldatum, so rutscht auch ein
// Foto mit altem Datum (über die Drive-App hochgeladen, in den Pool verschoben) nicht mehr durch.
// Die Abbilder entstehen aus kleinen Vorschaubildern direkt von Google (wie die Kacheln im Drive).
import { decodeSig, encodeSig, FINE, FINE_THUMB, fineGrid, groupLookalikes, LOOK_VERSION, signature, SOURCE, type Sig } from "./lookalike";
import { supabase } from "./supabase";
import { fetchThumbBlobs } from "./thumbSource";

const DB_NAME = "drivepool-look";
const STORE = "sig";
/** Vorschaugrösse fürs Abbild – immer dieselbe, damit die Abbilder vergleichbar bleiben */
const THUMB_SIZE = 96;
const BATCH = 40;
const PARALLEL = 2;
const PAGE = 1000;
/** Bis wann (Server-Zeit) die Abbilder schon geholt sind */
const PULL_KEY = "drivepool.look.pulled";
/** Abbilder von früher (nur auf diesem Gerät) einmal auf den Server bringen */
const PUSH_KEY = "drivepool.look.pushed";
/** Wann zuletzt verwaiste Abbilder auf dem Server weggeräumt wurden */
const PRUNE_KEY = "drivepool.look.pruned";
/** Früherer Stand (nur auf diesem Gerät) – wird nicht mehr gebraucht */
const OLD_STATE_KEY = "drivepool.look";

const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignorieren */
    }
  },
  remove: (k: string) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignorieren */
    }
  },
};

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

async function localMd5s(): Promise<Set<string>> {
  const keys = await req((await db()).transaction(STORE).objectStore(STORE).getAllKeys());
  return new Set(keys as string[]);
}

async function putLocal(entries: [string, Sig][]) {
  if (!entries.length) return;
  const tx = (await db()).transaction(STORE, "readwrite");
  for (const [md5, sig] of entries) tx.objectStore(STORE).put(sig, md5);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("IndexedDB-Fehler"));
  });
}

async function getLocal(md5s: string[]): Promise<Map<string, Sig>> {
  const out = new Map<string, Sig>();
  if (!md5s.length) return out;
  const store = (await db()).transaction(STORE).objectStore(STORE);
  const values = await Promise.all(md5s.map((m) => req(store.get(m) as IDBRequest<Sig | undefined>)));
  md5s.forEach((m, i) => values[i] && out.set(m, values[i]!));
  return out;
}

async function allLocal(): Promise<{ id: string; sig: Sig }[]> {
  const store = (await db()).transaction(STORE).objectStore(STORE);
  const [keys, values] = await Promise.all([req(store.getAllKeys()), req(store.getAll())]);
  return (keys as string[]).map((id, i) => ({ id, sig: values[i] as Sig }));
}

/** Wie viele Fotos sind auf diesem Gerät bekannt? */
export async function lookCount(): Promise<number> {
  try {
    return await req((await db()).transaction(STORE).objectStore(STORE).count());
  } catch {
    return 0;
  }
}

// ---- Server ----

interface ServerRow {
  md5: string;
  v: number;
  s: string | null;
  ar: number | null;
}

/** Abbilder auf den Server schreiben; `failed` = Vorschau liess sich nicht laden (später nochmals). */
async function putServer(entries: [string, Sig][], failed: string[] = [], keepExisting = false) {
  const rows: ServerRow[] = [
    ...entries.map(([md5, sig]) => ({ md5, v: LOOK_VERSION, s: encodeSig(sig), ar: sig.ar })),
    ...failed.map((md5) => ({ md5, v: LOOK_VERSION, s: null, ar: null })),
  ];
  for (let i = 0; i < rows.length; i += 300) {
    const { error } = await supabase
      .from("look_sigs")
      .upsert(rows.slice(i, i + 300), { onConflict: "owner_id,md5", ignoreDuplicates: keepExisting });
    if (error) throw new Error(error.message);
  }
}

/**
 * Abbilder holen, die seit dem letzten Mal auf dem Server dazugekommen sind (von allen Geräten).
 * Zuerst nur die Liste (Prüfsumme + Zeit), dann nur die Abbilder, die das Gerät noch nicht hat.
 */
async function pull(): Promise<void> {
  const since = ls.get(PULL_KEY);
  let newest = since;
  const local = await localMd5s();
  const want: string[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from("look_sigs").select("md5,updated_at").eq("v", LOOK_VERSION).not("s", "is", null);
    if (since) q = q.gte("updated_at", since);
    const { data, error } = await q.order("updated_at").order("md5").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { md5: string; updated_at: string }[];
    for (const r of rows) {
      if (!local.has(r.md5)) want.push(r.md5);
      if (!newest || r.updated_at > newest) newest = r.updated_at;
    }
    if (rows.length < PAGE) break;
  }
  await fetchServer(want);
  // Etwas Überlappung: ein Eintrag kann mit früherer Zeit erst nach dem Abholen sichtbar werden
  if (newest) ls.set(PULL_KEY, new Date(Date.parse(newest) - 5 * 60_000).toISOString());
}

/** Abbilder zu diesen Prüfsummen vom Server holen und auf dem Gerät ablegen. */
async function fetchServer(md5s: string[]): Promise<Map<string, Sig>> {
  const out = new Map<string, Sig>();
  for (let i = 0; i < md5s.length; i += 150) {
    const { data, error } = await supabase
      .from("look_sigs")
      .select("md5,s,ar")
      .eq("v", LOOK_VERSION)
      .not("s", "is", null)
      .in("md5", md5s.slice(i, i + 150));
    if (error) throw new Error(error.message);
    const got: [string, Sig][] = [];
    for (const r of (data ?? []) as { md5: string; s: string; ar: number }[]) {
      const sig = decodeSig(r.s, r.ar);
      if (sig) got.push([r.md5, sig]);
    }
    await putLocal(got);
    for (const [m, sg] of got) out.set(m, sg);
  }
  return out;
}

/** Einmalig: Abbilder, die dieses Gerät früher nur für sich gesammelt hat, auf den Server bringen. */
async function pushOldOnce(): Promise<void> {
  if (ls.get(PUSH_KEY)) return;
  const all = await allLocal();
  await putServer(
    all.map((e) => [e.id, e.sig]),
    [],
    true,
  );
  ls.set(PUSH_KEY, "1");
  ls.remove(OLD_STATE_KEY);
}

let syncing: Promise<void> | null = null;
/** Gerät und Server abgleichen (holt Neues, bringt einmalig Altes hoch). */
export function syncLook(): Promise<void> {
  syncing ??= (async () => {
    await pushOldOnce();
    await pull();
  })().finally(() => (syncing = null));
  return syncing;
}

export interface LookRow {
  account_id: string;
  drive_id: string;
  parent_drive_id: string | null;
  md5: string;
}

/** Bilder im Pool ohne Abbild (eines pro Prüfsumme). */
async function missingRows(): Promise<LookRow[]> {
  const out: LookRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.rpc("look_missing", { p_v: LOOK_VERSION }).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as LookRow[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** Wie viele Bilder im Pool haben noch kein Abbild? */
export async function lookMissingCount(): Promise<number> {
  const { data, error } = await supabase.rpc("look_missing_count", { p_v: LOOK_VERSION });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/** Höchstens einmal pro Woche: Abbilder gelöschter Fotos auf dem Server wegräumen. */
async function pruneSometimes() {
  const at = Number(ls.get(PRUNE_KEY) ?? 0);
  if (Date.now() - at < 7 * 24 * 3600_000) return;
  const { error } = await supabase.rpc("prune_look_sigs");
  if (!error) ls.set(PRUNE_KEY, String(Date.now()));
}

// ---- Bilder verkleinern ----

async function decode(blob: Blob): Promise<{ src: ImageBitmap | HTMLImageElement; w: number; h: number; done: () => void } | null> {
  try {
    if ("createImageBitmap" in window) {
      // Ausrichtung aus den EXIF-Daten übernehmen (Fotos vom Handy liegen sonst evtl. quer)
      const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
      return { src: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() };
    }
  } catch {
    /* unten mit <img> versuchen */
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

/**
 * Auf tw×th verkleinern – in Halbierungsschritten. Ein grosses Foto in einem Schritt auf wenige Punkte zu
 * zeichnen, lässt viele Bildpunkte aus (Safari) – dann passt das Abbild nicht mehr zur Vorschau von Google.
 */
function shrink(src: CanvasImageSource, w: number, h: number, tw: number, th: number): HTMLCanvasElement {
  let cur: CanvasImageSource = src;
  let cw = w;
  let ch = h;
  while (cw / 2 >= tw && ch / 2 >= th) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(cw / 2));
    c.height = Math.max(1, Math.round(ch / 2));
    const x = c.getContext("2d")!;
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = "high";
    x.drawImage(cur, 0, 0, c.width, c.height);
    cur = c;
    cw = c.width;
    ch = c.height;
  }
  const out = document.createElement("canvas");
  out.width = tw;
  out.height = th;
  const x = out.getContext("2d", { willReadFrequently: true })!;
  // Durchsichtiges zählt als Weiss
  x.fillStyle = "#fff";
  x.fillRect(0, 0, tw, th);
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = "high";
  x.drawImage(cur, 0, 0, tw, th);
  return out;
}

/** Grösse mit längster Seite `long` (wie Googles Vorschau „=sN“) */
const fit = (w: number, h: number, long: number): [number, number] => {
  const s = long / Math.max(w, h);
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
};

/** Pixel (RGBA) eines Bildes auf n×n – grosse Bilder erst auf die Vorschaugrösse `thumb` (wie bei Google). */
function pixelsOf(src: CanvasImageSource, w: number, h: number, thumb: number, n: number): Uint8ClampedArray {
  let cur: CanvasImageSource = src;
  let cw = w;
  let ch = h;
  if (Math.max(w, h) > thumb * 1.5) {
    [cw, ch] = fit(w, h, thumb);
    cur = shrink(src, w, h, cw, ch);
  }
  return shrink(cur, cw, ch, n, n).getContext("2d")!.getImageData(0, 0, n, n).data;
}

export interface LocalLook {
  sig: Sig;
  width: number;
  height: number;
}

/** Abbild eines Bildes – Vorschau von Google oder ganze Datei vom Handy (null = lässt sich nicht lesen). */
export async function lookFromBlob(blob: Blob): Promise<LocalLook | null> {
  const d = await decode(blob);
  if (!d) return null;
  try {
    if (!d.w || !d.h) return null;
    return { sig: signature(pixelsOf(d.src, d.w, d.h, THUMB_SIZE, SOURCE), d.w / d.h), width: d.w, height: d.h };
  } catch {
    return null;
  } finally {
    d.done();
  }
}

export async function sigFromBlob(blob: Blob): Promise<Sig | null> {
  return (await lookFromBlob(blob))?.sig ?? null;
}

/** Feinabbild (für Screenshots) aus einer grossen Vorschau oder der Datei. */
export async function fineFromBlob(blob: Blob): Promise<Uint8Array | null> {
  const d = await decode(blob);
  if (!d) return null;
  try {
    if (!d.w || !d.h) return null;
    return fineGrid(pixelsOf(d.src, d.w, d.h, FINE_THUMB, FINE));
  } catch {
    return null;
  } finally {
    d.done();
  }
}

// ---- Prüfen ----

export interface ScanProgress {
  done: number;
  total: number;
}

/** Nach Konto + Ordner bündeln (ein Aufruf holt die Vorschau-Links des Ordners). */
function batchesOf<T extends { account_id: string; parent_drive_id: string | null }>(rows: T[], size: number): T[][] {
  const byFolder = new Map<string, T[]>();
  for (const r of rows) {
    const k = `${r.account_id}|${r.parent_drive_id ?? ""}`;
    const list = byFolder.get(k);
    if (list) list.push(r);
    else byFolder.set(k, [r]);
  }
  const out: T[][] = [];
  for (const list of byFolder.values()) for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Abbilder aus Googles Vorschauen berechnen und speichern (Gerät + Server). */
async function compute(
  rows: LookRow[],
  { onProgress, signal }: { onProgress?: (done: number) => void; signal?: AbortSignal } = {},
): Promise<Map<string, Sig>> {
  const out = new Map<string, Sig>();
  const batches = batchesOf(rows, BATCH);
  let done = 0;
  const worker = async () => {
    for (let batch = batches.shift(); batch && !signal?.aborted; batch = batches.shift()) {
      try {
        const first = batch[0];
        const blobs = await fetchThumbBlobs(first.account_id, first.parent_drive_id, batch.map((b) => b.drive_id), THUMB_SIZE, {
          timeout: 45_000,
        });
        const sigs: [string, Sig][] = [];
        const failed: string[] = [];
        for (const r of batch) {
          const blob = blobs.get(r.drive_id);
          const sig = blob ? await sigFromBlob(blob) : null;
          if (sig) sigs.push([r.md5, sig]);
          else failed.push(r.md5);
        }
        await putLocal(sigs);
        for (const [m, s] of sigs) out.set(m, s);
        // Nicht ladbare merken – sonst würden sie bei jedem Lauf wieder versucht (nach 3 Tagen nochmals)
        await putServer(sigs, failed).catch(() => undefined);
      } catch {
        /* Konto nicht erreichbar o. ä. → beim nächsten Lauf nochmals */
      }
      done += batch.length;
      onProgress?.(done);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return out;
}

/**
 * Fotos prüfen, die noch kein Abbild haben (egal wie alt). Bricht `signal` ab, bleibt das Geprüfte erhalten –
 * der nächste Lauf macht weiter. Ergebnis: wie viele Fotos neu geprüft wurden.
 */
export async function scanLook({
  onProgress,
  signal,
}: {
  onProgress?: (p: ScanProgress) => void;
  signal?: AbortSignal;
} = {}): Promise<number> {
  await syncLook();
  const [rows, local] = await Promise.all([missingRows(), localMd5s()]);
  // Schon auf dem Gerät, aber nicht auf dem Server (z. B. Hochladen gescheitert): nur hochladen
  const onlyLocal = rows.filter((r) => local.has(r.md5)).map((r) => r.md5);
  if (onlyLocal.length) {
    const have = await getLocal(onlyLocal);
    await putServer([...have]).catch(() => undefined);
  }
  const todo = rows.filter((r) => !local.has(r.md5));
  onProgress?.({ done: 0, total: todo.length });
  const added = await compute(todo, { signal, onProgress: (done) => onProgress?.({ done, total: todo.length }) });
  if (!signal?.aborted) await pruneSometimes().catch(() => undefined);
  return added.size;
}

/** Abbilder zu diesen Prüfsummen (Gerät, sonst Server). Fehlende fehlen in der Antwort. */
export async function sigsFor(md5s: string[]): Promise<Map<string, Sig>> {
  const unique = [...new Set(md5s)];
  const out = await getLocal(unique).catch(() => new Map<string, Sig>());
  for (const [m, sg] of await fetchServer(unique.filter((m) => !out.has(m)))) out.set(m, sg);
  return out;
}

/**
 * Abbilder für diese Fotos – was fehlt, wird aus Googles Vorschauen berechnet (höchstens `max` Stück,
 * damit z. B. ein Upload in einen riesigen, nie geprüften Ordner nicht ewig wartet).
 */
export async function ensureSigs(rows: LookRow[], max = 600, signal?: AbortSignal): Promise<Map<string, Sig>> {
  const out = await sigsFor(rows.map((r) => r.md5));
  const seen = new Set<string>();
  const todo = rows.filter((r) => !out.has(r.md5) && !seen.has(r.md5) && seen.add(r.md5)).slice(0, max);
  if (todo.length) for (const [m, s] of await compute(todo, { signal })) out.set(m, s);
  return out;
}

/** Selbst berechnete Abbilder (z. B. beim Upload aus der Datei) speichern. */
export async function storeSigs(entries: [string, Sig][]): Promise<void> {
  if (!entries.length) return;
  await putLocal(entries).catch(() => undefined);
  await putServer(entries, [], true).catch(() => undefined);
}

/** Feinabbilder (für Screenshots) aus grossen Vorschauen von Google. Schlüssel: Konto|Datei. */
export async function fineFor(
  items: { account_id: string; drive_id: string; parent_drive_id: string | null }[],
): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const batch of batchesOf(items, 20)) {
    try {
      const first = batch[0];
      const blobs = await fetchThumbBlobs(first.account_id, first.parent_drive_id, batch.map((b) => b.drive_id), FINE_THUMB, {
        timeout: 60_000,
      });
      for (const it of batch) {
        const blob = blobs.get(it.drive_id);
        const g = blob ? await fineFromBlob(blob) : null;
        if (g) out.set(`${it.account_id}|${it.drive_id}`, g);
      }
    } catch {
      /* fehlt → gilt als „nicht sicher“ */
    }
  }
  return out;
}

/** Gruppen gleich aussehender Fotos als Listen von Prüfsummen (jede Gruppe: mindestens 2 verschiedene Dateien). */
export async function lookGroups(): Promise<string[][]> {
  const pause = () => new Promise<void>((r) => setTimeout(r, 0));
  return groupLookalikes(await allLocal(), pause);
}
