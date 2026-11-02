// Zwischenspeicher für Ordnerinhalte und Vorschau-Links:
// Ordner erscheinen sofort aus dem Speicher und werden im Hintergrund aktualisiert.
import { fetchFolder } from "./db";
import { listThumbnails } from "./google";
import type { Account, FolderContent } from "./types";

interface Entry {
  content: FolderContent;
  at: number;
  links?: Map<string, string>;
  linksAt?: number;
}

const folders = new Map<string, Entry>();
const inflight = new Map<string, Promise<FolderContent>>();
const LINKS_TTL = 40 * 60 * 1000;
const PREFETCH_TTL = 60 * 1000;

export function cachedFolder(key: string): Entry | undefined {
  return folders.get(key);
}

export function loadFolder(key: string): Promise<FolderContent> {
  const running = inflight.get(key);
  if (running) return running;
  const p = fetchFolder(key)
    .then((content) => {
      folders.set(key, { ...folders.get(key), content, at: Date.now() });
      return content;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Im Hintergrund vorladen, falls nicht frisch im Speicher. */
export function prefetchFolder(key: string) {
  const e = folders.get(key);
  if (e && Date.now() - e.at < PREFETCH_TTL) return;
  void loadFolder(key).catch(() => undefined);
}

/** Vorschau-Links für alle Fotos des Ordners (pro physischem Ordner ein Google-Aufruf). */
export async function loadLinks(key: string, content: FolderContent): Promise<Map<string, string>> {
  const e = folders.get(key);
  const fresh = e?.links && Date.now() - (e.linksAt ?? 0) < LINKS_TTL;
  const complete = fresh && content.files.every((f) => e!.links!.has(f.drive_id));
  if (fresh && (complete || Date.now() - (e!.linksAt ?? 0) < 20_000)) return e!.links!;

  const groups = new Map<string, { accountId: string; folderId: string }>();
  for (const f of content.files) {
    if (f.parent_drive_id) {
      groups.set(`${f.account_id}|${f.parent_drive_id}`, { accountId: f.account_id, folderId: f.parent_drive_id });
    }
  }
  const merged = new Map<string, string>(e?.links ?? []);
  await Promise.all(
    [...groups.values()].map((g) =>
      listThumbnails(g.accountId, g.folderId)
        .then((m) => m.forEach((v, k) => merged.set(k, v)))
        .catch(() => undefined),
    ),
  );
  const cur = folders.get(key);
  if (cur) folders.set(key, { ...cur, links: merged, linksAt: Date.now() });
  return merged;
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
  } catch {
    /* ignorieren */
  }
}
