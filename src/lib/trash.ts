// Papierkorb über alle Konten (Regel 10): anzeigen, wiederherstellen, endgültig löschen, automatisch leeren.
import { fetchSettings, writeLog } from "./db";
import { deleteForever, listTrash, type TrashFile } from "./google";
import type { Account, Item } from "./types";

export interface TrashEntry {
  account: Account;
  file: TrashFile;
}

export async function loadTrash(accounts: Account[]): Promise<TrashEntry[]> {
  const active = accounts.filter((a) => a.status === "active");
  const lists = await Promise.all(
    active.map((a) => listTrash(a.id).then((files) => files.map((file) => ({ account: a, file })))),
  );
  return lists.flat().sort((x, y) => (y.file.trashedTime ?? "").localeCompare(x.file.trashedTime ?? ""));
}

/** Für die Vorschaubild-Kachel. */
export function trashEntryItem(e: TrashEntry): Item {
  return {
    account_id: e.account.id,
    drive_id: e.file.id,
    name: e.file.name,
    is_folder: e.file.mimeType === "application/vnd.google-apps.folder",
    mime_type: e.file.mimeType,
    parent_drive_id: null,
    size: e.file.size ? Number(e.file.size) : null,
    md5: null,
    taken_at: null,
    description: null,
    path: null,
    parent_key: null,
  };
}

/** Löscht Einträge, die länger als `days` Tage im Papierkorb liegen. */
export async function purgeOlderThan(accounts: Account[], days: number): Promise<{ count: number; bytes: number }> {
  const cutoff = Date.now() - days * 86_400_000;
  const old = (await loadTrash(accounts)).filter((e) => e.file.trashedTime && Date.parse(e.file.trashedTime) < cutoff);
  let count = 0;
  let bytes = 0;
  for (const e of old) {
    try {
      await deleteForever(e.account.id, e.file.id);
      count++;
      bytes += Number(e.file.size ?? 0);
    } catch {
      /* nächstes Mal erneut */
    }
  }
  if (count) await writeLog("delete", `Papierkorb: ${count} Einträge älter als ${days} Tage endgültig gelöscht`);
  return { count, bytes };
}

const STAMP = "drivepool.trashPurgedAt";

/** Höchstens einmal pro Tag beim App-Start. */
export async function autoPurgeIfDue(accounts: Account[]): Promise<{ count: number; bytes: number } | null> {
  try {
    const last = Number(localStorage.getItem(STAMP) ?? 0);
    if (Date.now() - last < 86_400_000) return null;
    const { trash_auto_days } = await fetchSettings();
    localStorage.setItem(STAMP, String(Date.now()));
    if (!trash_auto_days) return null;
    return await purgeOlderThan(accounts, trash_auto_days);
  } catch {
    return null;
  }
}
