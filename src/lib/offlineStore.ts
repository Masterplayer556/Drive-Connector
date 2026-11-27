// Speicher für „offline verfügbare“ Ordner: eigener Cache (Cache Storage), den das Aufräumen der
// Vorschaubilder (thumbEvict.ts) und der Service Worker (public/sw.js räumt nur „drive-pool-…“) nicht anfasst.
// Bilder liegen unter denselben Adressen wie im Vorschau-Cache („__thumbs/<konto>/<datei>/<grösse>“),
// Ordnerinhalte als JSON unter „__offline/folder/<schlüssel>“.
import type { FolderContent } from "./types";

export const OFFLINE_CACHE = "drivepool-offline-v1";

let cachePromise: Promise<Cache | null> | null = null;
export function offlineCache(): Promise<Cache | null> {
  if (!cachePromise) {
    cachePromise = (typeof caches !== "undefined" ? caches.open(OFFLINE_CACHE) : Promise.resolve(null)).catch(() => null);
  }
  return cachePromise;
}

export const snapshotUrl = (key: string) => new URL(`./__offline/folder/${encodeURIComponent(key) || "_root"}`, document.baseURI).toString();
export const listUrl = (key: string) => new URL(`./__offline/list/${encodeURIComponent(key) || "_root"}`, document.baseURI).toString();

/** Gespeicherter Ordnerinhalt (für ohne Netz) – mit dem Datum, an dem er gesichert wurde. */
export async function readSnapshot(key: string): Promise<(FolderContent & { offlineAt: string }) | null> {
  try {
    const res = await (await offlineCache())?.match(snapshotUrl(key));
    return res ? ((await res.json()) as FolderContent & { offlineAt: string }) : null;
  } catch {
    return null;
  }
}
