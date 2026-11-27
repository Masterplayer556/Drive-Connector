// Vorschaubilder: Speicher → Cache auf dem Gerät → im Paket vom Server.
// Jedes Bild wird nur einmal übers Netz geladen; danach kommt es sofort aus dem Gerätespeicher.
import { offlineCache } from "./offlineStore";
import { pickEvictions } from "./thumbEvict";
import { fetchThumbBlobs } from "./thumbSource";
import type { Item } from "./types";

export const GRID_SIZE = 320;
export const VIEW_SIZE = 1600;

const CACHE_NAME = "drivepool-thumbs-v1";
const BATCH = 30;
const PARALLEL = 3;

const mem = new Map<string, { url: string; bytes: number }>(); // Schlüssel → Object-URL (zuletzt benutzte zuletzt)
let memBytes = 0;
/** Höchstens so viel an Vorschaubildern im Arbeitsspeicher – ältere bleiben im Gerätespeicher (Cache) und kommen von dort zurück */
const MEM_MAX_BYTES = 40 * 1024 * 1024;

function remember(key: string, url: string, bytes?: number) {
  const old = mem.get(key);
  if (old) {
    mem.delete(key);
    memBytes -= old.bytes;
  }
  const size = bytes ?? old?.bytes ?? 0;
  mem.set(key, { url, bytes: size });
  memBytes += size;
  while (memBytes > MEM_MAX_BYTES && mem.size > 1) {
    const [oldKey, e] = mem.entries().next().value as [string, { url: string; bytes: number }];
    mem.delete(oldKey);
    memBytes -= e.bytes;
    // Freigeben erst etwas später: ein gerade angezeigtes Bild hat seine Daten dann längst geladen
    setTimeout(() => URL.revokeObjectURL(e.url), 10_000);
  }
}
const inflight = new Map<string, Promise<string>>();

interface Pending {
  item: Item;
  size: number;
  resolve: (url: string) => void;
  reject: (e: Error) => void;
}
const queue: Pending[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let running = 0;

const keyOf = (item: Item, size: number) => `${item.account_id}/${item.drive_id}/${size}`;
const cacheUrl = (key: string) => new URL(`./__thumbs/${key}`, document.baseURI).toString();
/** Adresse eines Vorschaubilds im Gerätespeicher (gleich im Vorschau- und im Offline-Cache). */
export const thumbCacheUrl = (item: Pick<Item, "account_id" | "drive_id">, size: number) => cacheUrl(`${item.account_id}/${item.drive_id}/${size}`);

let cachePromise: Promise<Cache | null> | null = null;
function deviceCache(): Promise<Cache | null> {
  if (!cachePromise) {
    cachePromise = ("caches" in window ? caches.open(CACHE_NAME) : Promise.resolve(null)).catch(() => null);
  }
  return cachePromise;
}

/** Sofort verfügbar (ohne Warten)? */
export function peekThumb(item: Item, size = GRID_SIZE): string | null {
  const key = keyOf(item, size);
  const hit = mem.get(key);
  if (hit) remember(key, hit.url); // als „frisch benutzt“ markieren
  return hit?.url ?? null;
}

/**
 * Vorschaubild holen. `urgent`: wird gerade angezeigt → vor alle wartenden (vorgeladenen) Bilder stellen
 * und ohne die kurze Sammelpause losschicken.
 */
export function getThumb(item: Item, size = GRID_SIZE, { urgent = false }: { urgent?: boolean } = {}): Promise<string> {
  const key = keyOf(item, size);
  const hit = mem.get(key);
  if (hit) {
    remember(key, hit.url);
    return Promise.resolve(hit.url);
  }
  const waiting = inflight.get(key);
  if (waiting) {
    if (urgent) promote(key);
    return waiting;
  }

  const p = (async () => {
    const cache = await deviceCache();
    // Erst der normale Vorschau-Cache, dann die offline gesicherten Ordner
    const cached =
      (await cache?.match(cacheUrl(key)).catch(() => undefined)) ??
      (await offlineCache().then((c) => c?.match(cacheUrl(key))).catch(() => undefined));
    if (cached) {
      urgentKeys.delete(key);
      const blob = await cached.blob();
      const url = URL.createObjectURL(blob);
      remember(key, url, blob.size);
      return url;
    }
    return new Promise<string>((resolve, reject) => {
      const pending = { item, size, resolve, reject };
      if (urgent || urgentKeys.delete(key)) {
        queue.unshift(pending);
        if (timer) clearTimeout(timer);
        flush();
      } else {
        queue.push(pending);
        if (!timer) timer = setTimeout(flush, 30);
      }
    });
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Schlüssel, die dringend wurden, während sie noch im Gerätespeicher gesucht werden */
const urgentKeys = new Set<string>();

/** Ein schon wartendes Bild nach vorne holen (z. B. vorgeladen, jetzt aber angezeigt). */
function promote(key: string) {
  const i = queue.findIndex((p) => keyOf(p.item, p.size) === key);
  if (i < 0) {
    urgentKeys.add(key); // noch in der Cache-Abfrage – kommt gleich vorne in die Warteschlange
    return;
  }
  if (i > 0) queue.unshift(...queue.splice(i, 1));
  if (timer) clearTimeout(timer);
  flush();
}

function flush() {
  timer = null;
  pump();
}

/** Arbeitet die Warteschlange in Paketen ab (gleiches Konto + Ordner + Grösse). */
function pump() {
  while (running < PARALLEL && queue.length) {
    const first = queue[0];
    const group = (p: Pending) =>
      p.item.account_id === first.item.account_id &&
      p.item.parent_drive_id === first.item.parent_drive_id &&
      p.size === first.size;
    const batch: Pending[] = [];
    for (let i = 0; i < queue.length && batch.length < BATCH; ) {
      if (group(queue[i])) batch.push(...queue.splice(i, 1));
      else i++;
    }
    running++;
    void runBatch(batch).finally(() => {
      running--;
      pump();
    });
  }
}

async function runBatch(batch: Pending[]) {
  const { item, size } = batch[0];
  const ids = [...new Set(batch.map((b) => b.item.drive_id))];
  const done = new Set<Pending>();
  // Jedes Bild sofort ausliefern, sobald es da ist – nicht erst, wenn das ganze Paket fertig ist
  const deliver = (id: string, blob: Blob) => {
    for (const b of batch) {
      if (b.item.drive_id !== id || done.has(b)) continue;
      done.add(b);
      const key = keyOf(b.item, size);
      const url = mem.get(key)?.url ?? URL.createObjectURL(blob);
      remember(key, url, blob.size);
      void deviceCache().then((cache) =>
        cache?.put(cacheUrl(key), new Response(blob, { headers: { "Content-Type": blob.type } })).catch(() => undefined),
      );
      b.resolve(url);
    }
  };
  try {
    const blobs = await fetchThumbBlobs(item.account_id, item.parent_drive_id ?? null, ids, size, { onBlob: deliver });
    for (const [id, blob] of blobs) deliver(id, blob);
    for (const b of batch) if (!done.has(b)) b.reject(new Error("Keine Vorschau"));
  } catch (e) {
    for (const b of batch) if (!done.has(b)) b.reject(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Alte Vorschaubilder vom Gerät räumen, wenn die Obergrenzen überschritten sind (siehe thumbEvict.ts).
 * Die Bilder sind nur ein Zwischenspeicher – was fehlt, wird beim nächsten Ansehen neu geholt.
 */
/** Bild aus dem Vorschau-Cache (falls schon einmal angesehen) – spart beim Offline-Sichern den Download. */
export async function cachedThumbBlob(item: Item, size: number): Promise<Blob | null> {
  const res = await (await deviceCache())?.match(cacheUrl(keyOf(item, size))).catch(() => undefined);
  return res ? res.blob() : null;
}

export async function pruneThumbCache(): Promise<number> {
  const cache = await deviceCache();
  if (!cache) return 0;
  try {
    const gone = pickEvictions((await cache.keys()).map((r) => r.url));
    for (const url of gone) await cache.delete(url);
    return gone.length;
  } catch {
    return 0;
  }
}

/** Fotos eines Ordners im Voraus laden (z. B. beim Antippen des Ordners). */
export function warmThumbs(items: Item[], count = 12) {
  for (const it of items.slice(0, count)) void getThumb(it).catch(() => undefined);
}
