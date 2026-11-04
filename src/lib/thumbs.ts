// Vorschaubilder: Speicher → Cache auf dem Gerät → im Paket vom Server.
// Jedes Bild wird nur einmal übers Netz geladen; danach kommt es sofort aus dem Gerätespeicher.
import { callFunction } from "./supabase";
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

export function getThumb(item: Item, size = GRID_SIZE): Promise<string> {
  const key = keyOf(item, size);
  const hit = mem.get(key);
  if (hit) {
    remember(key, hit.url);
    return Promise.resolve(hit.url);
  }
  const waiting = inflight.get(key);
  if (waiting) return waiting;

  const p = (async () => {
    const cache = await deviceCache();
    const cached = await cache?.match(cacheUrl(key)).catch(() => undefined);
    if (cached) {
      const blob = await cached.blob();
      const url = URL.createObjectURL(blob);
      remember(key, url, blob.size);
      return url;
    }
    return new Promise<string>((resolve, reject) => {
      queue.push({ item, size, resolve, reject });
      if (!timer) timer = setTimeout(flush, 30);
    });
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",", 2);
  const type = /data:([^;]+)/.exec(head)?.[1] ?? "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
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
  try {
    const r = await callFunction<{ thumbs: Record<string, string>; missing: string[] }>("thumb", {
      account_id: item.account_id,
      folder_id: item.parent_drive_id,
      ids,
      size,
    });
    const cache = await deviceCache();
    for (const b of batch) {
      const data = r.thumbs[b.item.drive_id];
      if (!data) {
        b.reject(new Error("Keine Vorschau"));
        continue;
      }
      const blob = dataUrlToBlob(data);
      const key = keyOf(b.item, size);
      const url = mem.get(key)?.url ?? URL.createObjectURL(blob);
      remember(key, url, blob.size);
      void cache?.put(cacheUrl(key), new Response(blob, { headers: { "Content-Type": blob.type } })).catch(() => undefined);
      b.resolve(url);
    }
  } catch (e) {
    for (const b of batch) b.reject(e instanceof Error ? e : new Error(String(e)));
  }
}

/** Fotos eines Ordners im Voraus laden (z. B. beim Antippen des Ordners). */
export function warmThumbs(items: Item[], count = 12) {
  for (const it of items.slice(0, count)) void getThumb(it).catch(() => undefined);
}
