// Zwischenspeicher für Ordnerinhalte und Vorschau-Links:
// Ordner erscheinen sofort aus dem Speicher und werden im Hintergrund aktualisiert.
import { fetchFolder } from "./db";
import type { Account, FolderContent } from "./types";

interface Entry {
  content: FolderContent;
  at: number;
}

const folders = new Map<string, Entry>();
const inflight = new Map<string, Promise<FolderContent>>();
const PREFETCH_TTL = 60 * 1000;

// Oberste Ebene zusätzlich auf dem Gerät merken → nach dem Öffnen der App sofort sichtbar
const ROOT_KEY = "drivepool.root";

export function cachedFolder(key: string): Entry | undefined {
  const hit = folders.get(key);
  if (hit || key !== "") return hit;
  try {
    const raw = localStorage.getItem(ROOT_KEY);
    if (!raw) return undefined;
    const e = { content: JSON.parse(raw) as FolderContent, at: 0 };
    folders.set(key, e);
    return e;
  } catch {
    return undefined;
  }
}

export function loadFolder(key: string): Promise<FolderContent> {
  const running = inflight.get(key);
  if (running) return running;
  const p = fetchFolder(key)
    .then((content) => {
      folders.set(key, { ...folders.get(key), content, at: Date.now() });
      if (key === "") {
        try {
          localStorage.setItem(ROOT_KEY, JSON.stringify(content));
        } catch {
          /* ignorieren */
        }
      }
      return content;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Im Hintergrund vorladen, falls nicht frisch im Speicher. */
export function prefetchFolder(key: string): Promise<FolderContent | null> {
  const e = folders.get(key);
  if (e && Date.now() - e.at < PREFETCH_TTL) return Promise.resolve(e.content);
  return loadFolder(key).catch(() => null);
}

export function patchFolder(key: string, fn: (c: FolderContent) => FolderContent) {
  const e = folders.get(key);
  if (e) folders.set(key, { ...e, content: fn(e.content) });
}

export function invalidateFolder(key: string) {
  const e = folders.get(key);
  if (e) folders.set(key, { ...e, at: 0 });
}

export function invalidateAll() {
  for (const [k, e] of folders) folders.set(k, { ...e, at: 0 });
}

// Konten lokal merken → App startet ohne Warten auf den Server
const ACCOUNTS_KEY = "drivepool.accounts";

export function readCachedAccounts(): Account[] | null {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    return raw ? (JSON.parse(raw) as Account[]) : null;
  } catch {
    return null;
  }
}

export function writeCachedAccounts(accounts: Account[]) {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    /* ignorieren */
  }
}

export function clearLocalCaches() {
  folders.clear();
  try {
    localStorage.removeItem(ACCOUNTS_KEY);
    localStorage.removeItem(ROOT_KEY);
  } catch {
    /* ignorieren */
  }
}
