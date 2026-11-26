// Papierkorb über alle Konten (Regel 10): anzeigen, wiederherstellen, endgültig löschen, automatisch leeren.
import { fetchSettings, writeLog } from "./db";
import { supabase } from "./supabase";
import { deleteForever, listTrash, type TrashFile } from "./google";
import { DRIVE_PARALLEL, mapPool } from "./pool";
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

/**
 * Seit wann liegt der Eintrag im Papierkorb? Google füllt „trashedTime“ nur bei geteilten Ablagen zuverlässig –
 * sonst gilt, wann die App ihn zum ersten Mal dort gesehen hat (Tabelle trash_seen). Unbekannt → null.
 */
export function trashedSince(file: { trashedTime?: string }, seenAt: string | undefined): number | null {
  const t = file.trashedTime ? Date.parse(file.trashedTime) : NaN;
  if (!Number.isNaN(t)) return t;
  const s = seenAt ? Date.parse(seenAt) : NaN;
  return Number.isNaN(s) ? null : s;
}

/** Erstes Sehen im Papierkorb festhalten und die bekannten Daten liefern (Schlüssel „Konto|ID“). */
async function noteSeen(accounts: Account[], entries: TrashEntry[]): Promise<Map<string, string>> {
  const key = (a: string, d: string) => `${a}|${d}`;
  const seen = new Map<string, string>();
  const { data, error } = await supabase.from("trash_seen").select("account_id,drive_id,seen_at");
  if (error) throw new Error(error.message);
  for (const r of data ?? []) seen.set(key(r.account_id, r.drive_id), r.seen_at);
  const fresh = entries.filter((e) => !e.file.trashedTime && !seen.has(key(e.account.id, e.file.id)));
  for (let i = 0; i < fresh.length; i += 500) {
    await supabase
      .from("trash_seen")
      .upsert(
        fresh.slice(i, i + 500).map((e) => ({ account_id: e.account.id, drive_id: e.file.id })),
        { onConflict: "account_id,drive_id", ignoreDuplicates: true },
      );
  }
  // Nicht mehr im Papierkorb (wiederhergestellt oder gelöscht) → vergessen
  const inTrash = new Set(entries.map((e) => key(e.account.id, e.file.id)));
  const accountIds = new Set(accounts.filter((a) => a.status === "active").map((a) => a.id));
  const stale = (data ?? []).filter((r) => accountIds.has(r.account_id) && !inTrash.has(key(r.account_id, r.drive_id)));
  for (const r of stale.slice(0, 500)) await supabase.from("trash_seen").delete().eq("account_id", r.account_id).eq("drive_id", r.drive_id);
  return seen;
}

/** Löscht Einträge, die länger als `days` Tage im Papierkorb liegen. */
export async function purgeOlderThan(accounts: Account[], days: number): Promise<{ count: number; bytes: number }> {
  const cutoff = Date.now() - days * 86_400_000;
  const all = await loadTrash(accounts);
  const seen = await noteSeen(accounts, all);
  const old = all.filter((e) => {
    const t = trashedSince(e.file, seen.get(`${e.account.id}|${e.file.id}`));
    return t !== null && t < cutoff;
  });
  let count = 0;
  let bytes = 0;
  await mapPool(old, DRIVE_PARALLEL, async (e) => {
    try {
      await deleteForever(e.account.id, e.file.id);
      count++;
      bytes += Number(e.file.size ?? 0);
    } catch {
      /* nächstes Mal erneut */
    }
  });
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
