// Ordner „offline verfügbar“ (z. B. vor einer Prüfung): Fotos samt Unterordnern als Raster- und grosse
// Vorschau (1600 px) auf dem Gerät sichern, dazu die Ordnerinhalte. Die App zeigt sie dann auch ohne Netz.
// Videos und Originale kommen nicht mit (zu gross) – sie brauchen weiterhin Netz.
import { loadFolder } from "./cache";
import { listUrl, offlineCache, snapshotUrl } from "./offlineStore";
import { cachedThumbBlob, GRID_SIZE, thumbCacheUrl, VIEW_SIZE } from "./thumbs";
import { fetchThumbBlobs } from "./thumbSource";
import type { FolderContent, Item } from "./types";

const INDEX_KEY = "drivepool.offline";
/** Höchstens so viele Unterordner pro gesichertem Ordner */
const MAX_FOLDERS = 300;
const SIZES = [GRID_SIZE, VIEW_SIZE];

export interface OfflineFolder {
  key: string;
  path: string;
  name: string;
  /** Zeitpunkt der letzten Sicherung */
  at: string;
  photos: number;
  /** Fotos, deren Vorschau nicht geladen werden konnte */
  missing: number;
  /** Videos (nicht offline) */
  videos: number;
  bytes: number;
}

export interface OfflineProgress {
  done: number;
  total: number;
  phase: "folders" | "photos";
}

const listeners = new Set<() => void>();
export function onOfflineChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function offlineFolders(): OfflineFolder[] {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) ?? "[]") as OfflineFolder[];
  } catch {
    return [];
  }
}

function saveIndex(list: OfflineFolder[]) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  for (const fn of listeners) fn();
}

export const isOfflineFolder = (key: string) => offlineFolders().some((f) => f.key === key);

/** Bilder, die nach dem Entfernen eines Ordners keiner der übrigen offline Ordner mehr braucht. */
export function orphanedUrls(removed: readonly string[], kept: readonly (readonly string[])[]): string[] {
  const still = new Set(kept.flat());
  return [...new Set(removed)].filter((u) => !still.has(u));
}

/** Fotos (keine Videos) aus den gesicherten Ordnerinhalten, jedes nur einmal. */
export function photosOf(contents: readonly FolderContent[]): { photos: Item[]; videos: number } {
  const seen = new Set<string>();
  const photos: Item[] = [];
  let videos = 0;
  for (const c of contents) {
    for (const f of c.files) {
      const k = `${f.account_id}/${f.drive_id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (f.mime_type?.startsWith("video/")) videos++;
      else if (f.mime_type?.startsWith("image/")) photos.push(f);
    }
  }
  return { photos, videos };
}

const ancestorsOf = (key: string) => {
  const segs = key.split("/");
  return segs.map((_, i) => segs.slice(0, i).join("/")); // "" (oberste Ebene), "a", "a/b" … ohne key selbst
};

/**
 * Ordner samt Unterordnern offline sichern. Schon gesicherte Bilder werden übersprungen – ein zweiter Lauf
 * ergänzt also nur Neues („Aktualisieren“). `signal.stop` bricht ab; Gesichertes bleibt erhalten.
 */
export async function makeOffline(
  folder: { key: string; path: string; name: string },
  onProgress: (p: OfflineProgress) => void,
  signal: { stop: boolean } = { stop: false },
): Promise<OfflineFolder> {
  const cache = await offlineCache();
  if (!cache) throw new Error("Dieser Browser kann nichts offline speichern");
  const at = new Date().toISOString();
  const put = (url: string, body: Blob | string, type: string) => {
    const size = typeof body === "string" ? new Blob([body]).size : body.size;
    return cache.put(url, new Response(body, { headers: { "Content-Type": type, "Content-Length": String(size) } }));
  };

  // 1. Ordnerinhalte: der Ordner, alle Unterordner und der Weg dorthin (zum Hinnavigieren ohne Netz)
  const contents: FolderContent[] = [];
  const queue = [folder.key];
  const seen = new Set<string>();
  while (queue.length && seen.size < MAX_FOLDERS && !signal.stop) {
    const key = queue.shift()!;
    if (seen.has(key)) continue;
    seen.add(key);
    onProgress({ done: seen.size, total: seen.size + queue.length, phase: "folders" });
    const c = await loadFolder(key);
    if (c.offlineAt) throw new Error("Kein Netz – Ordner lässt sich gerade nicht sichern");
    contents.push(c);
    await put(snapshotUrl(key), JSON.stringify({ ...c, offlineAt: at }), "application/json");
    queue.push(...c.folders.map((f) => f.key));
  }
  if (signal.stop) throw new Error("Abgebrochen");
  if (queue.length) throw new Error(`Zu viele Unterordner (mehr als ${MAX_FOLDERS}) – bitte einen kleineren Ordner wählen`);
  for (const key of ancestorsOf(folder.key)) {
    const c = await loadFolder(key).catch(() => null);
    if (c && !c.offlineAt) await put(snapshotUrl(key), JSON.stringify({ ...c, offlineAt: at }), "application/json");
  }

  // 2. Vorschaubilder (Raster + gross) – vorhandene überspringen, aus dem Vorschau-Cache übernehmen, Rest laden
  const { photos, videos } = photosOf(contents);
  const urls: string[] = [];
  const todo: { item: Item; size: number; url: string }[] = [];
  let done = 0;
  for (const item of photos) {
    for (const size of SIZES) {
      const url = thumbCacheUrl(item, size);
      urls.push(url);
      if (await cache.match(url)) done++;
      else todo.push({ item, size, url });
    }
  }
  const total = urls.length;
  const report = () => onProgress({ done, total, phase: "photos" });
  report();
  const missing = new Set<string>();
  // Gruppen: gleiches Konto, gleicher Ordner, gleiche Grösse – so holt fetchThumbBlobs sie im Paket
  const groups = new Map<string, typeof todo>();
  for (const t of todo) {
    const g = `${t.item.account_id}|${t.item.parent_drive_id ?? ""}|${t.size}`;
    groups.set(g, [...(groups.get(g) ?? []), t]);
  }
  for (const group of groups.values()) {
    for (let i = 0; i < group.length && !signal.stop; i += 30) {
      const part = group.slice(i, i + 30);
      const need: typeof part = [];
      for (const t of part) {
        const blob = await cachedThumbBlob(t.item, t.size);
        if (blob) {
          await put(t.url, blob, blob.type);
          done++;
        } else need.push(t);
      }
      report();
      if (!need.length) continue;
      const first = need[0];
      const blobs = await fetchThumbBlobs(first.item.account_id, first.item.parent_drive_id ?? null, need.map((t) => t.item.drive_id), first.size).catch(
        () => new Map<string, Blob>(),
      );
      for (const t of need) {
        const blob = blobs.get(t.item.drive_id);
        if (blob) {
          await put(t.url, blob, blob.type);
          done++;
        } else missing.add(`${t.item.account_id}/${t.item.drive_id}`);
      }
      report();
    }
  }
  if (signal.stop) throw new Error("Abgebrochen – schon Gesichertes bleibt, „Offline sichern“ macht weiter");

  // 3. Liste der Bilder dieses Ordners (zum späteren Entfernen) und Grösse
  await put(listUrl(folder.key), JSON.stringify(urls), "application/json");
  let bytes = 0;
  for (const url of urls) {
    const res = await cache.match(url);
    if (res) bytes += Number(res.headers.get("Content-Length")) || (await res.blob()).size;
  }
  const record: OfflineFolder = { key: folder.key, path: folder.path, name: folder.name, at, photos: photos.length, missing: missing.size, videos, bytes };
  saveIndex([...offlineFolders().filter((f) => f.key !== folder.key), record]);
  return record;
}

async function readList(cache: Cache, key: string): Promise<string[]> {
  try {
    const res = await cache.match(listUrl(key));
    return res ? ((await res.json()) as string[]) : [];
  } catch {
    return [];
  }
}

/** Offline-Sicherung eines Ordners entfernen (Bilder, die ein anderer gesicherter Ordner braucht, bleiben). */
export async function removeOffline(key: string): Promise<void> {
  const cache = await offlineCache();
  const rest = offlineFolders().filter((f) => f.key !== key);
  if (cache) {
    const removed = await readList(cache, key);
    const kept = await Promise.all(rest.map((f) => readList(cache, f.key)));
    for (const url of orphanedUrls(removed, kept)) await cache.delete(url);
    await cache.delete(listUrl(key));
    // Ordnerinhalte: nur, wenn kein anderer gesicherter Ordner sie (als Unter- oder Oberordner) braucht
    const needed = (k: string) => rest.some((f) => k === f.key || k.startsWith(`${f.key}/`) || f.key.startsWith(k === "" ? "" : `${k}/`));
    for (const req of await cache.keys()) {
      const m = /\/__offline\/folder\/(.+)$/.exec(req.url);
      if (!m) continue;
      const k = m[1] === "_root" ? "" : decodeURIComponent(m[1]);
      if ((k === key || k.startsWith(`${key}/`) || key.startsWith(k === "" ? "" : `${k}/`)) && !needed(k)) await cache.delete(req);
    }
  }
  saveIndex(rest);
}
