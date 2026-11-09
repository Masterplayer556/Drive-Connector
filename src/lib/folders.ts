// Ordner anlegen (Pfade in einem Konto sicherstellen), Ordner und Fotos löschen.
import { createFolder, moveWithin, trashItem, updateItem } from "./google";
import { moveFolderHues } from "./folderColors";
import { supabase } from "./supabase";
import { fetchFolderParts, findFolderInAccount, syncAccounts, writeLog, writeLogs } from "./db";
import { childPath } from "./naming";
import { DRIVE_PARALLEL, mapPool } from "./pool";
import { accountStates, areaOf, chooseAccount, crossesSealed, noAccountMessage } from "./placement";
import type { Account, Crumb, Item, LogicalFolder } from "./types";

export function pathSegments(path: string): string[] {
  return path ? path.split("/") : [];
}

/**
 * Stellt einen Ordnerpfad in einem Konto sicher und legt fehlende Ordner an
 * (leere Hilfsordner, damit der Pfad in jedem Konto gleich aussieht).
 */
export class PathResolver {
  private cache = new Map<string, string>();
  readonly created: { accountId: string; path: string }[] = [];

  constructor(private accounts: Account[]) {}

  async ensure(accountId: string, segments: string[]): Promise<string> {
    const acc = this.accounts.find((a) => a.id === accountId);
    if (!acc?.root_folder_id) throw new Error("Konto noch nicht synchronisiert");
    let parent = acc.root_folder_id;
    let path = "";
    for (const seg of segments) {
      path = childPath(path, seg);
      const key = `${accountId}|${path.toLowerCase()}`;
      let id = this.cache.get(key);
      if (!id) {
        id = (await findFolderInAccount(accountId, path))?.drive_id;
        if (!id) {
          id = (await createFolder(accountId, seg, parent)).id;
          this.created.push({ accountId, path });
        }
        this.cache.set(key, id);
      }
      parent = id;
    }
    return parent;
  }
}

export const SEALED_MESSAGE = "Privat und Claude sind abgeschottet – nichts kann hinein- oder herausverschoben werden";

/** Neuen Ordner im aktuellen Ordner anlegen – im passenden Konto (Regel 3). */
export async function createLogicalFolder(parent: Crumb, name: string, accounts: Account[]): Promise<string> {
  const parts = await fetchFolderParts(parent.path);
  const path = childPath(parent.path, name);
  const accountId = chooseAccount(accountStates(accounts), {
    folderAccounts: [...new Set(parts.map((p) => p.account_id))],
    area: areaOf(path),
    size: 0,
  });
  if (!accountId) throw new Error(noAccountMessage(areaOf(path)));
  const resolver = new PathResolver(accounts);
  await resolver.ensure(accountId, pathSegments(path));
  const email = accounts.find((a) => a.id === accountId)?.email;
  await writeLog("folder", `Ordner „${path}“ erstellt`, { account: email, created: resolver.created });
  await syncAccounts([accountId]);
  return path;
}

/** Logischen Ordner in allen Konten in den Papierkorb verschieben. */
export async function trashLogicalFolder(folder: LogicalFolder): Promise<void> {
  const parts = await fetchFolderParts(folder.path);
  for (const p of parts) await trashItem(p.account_id, p.drive_id);
  await writeLog("delete", `Ordner „${folder.path}“ in den Papierkorb verschoben`, {
    konten: parts.length,
  });
  await syncAccounts([...new Set(parts.map((p) => p.account_id))]);
}

/** Fotos in den Papierkorb verschieben. */
export async function trashFiles(items: Item[]): Promise<{ ok: number; failed: string[] }> {
  let ok = 0;
  const failed: string[] = [];
  await mapPool(items, DRIVE_PARALLEL, async (it) => {
    try {
      await trashItem(it.account_id, it.drive_id);
      ok++;
    } catch (e) {
      failed.push(`${it.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  await writeLogs([
    {
      kind: "delete",
      message: `${ok} Foto(s) in den Papierkorb verschoben`,
      details: { namen: items.map((i) => i.path ?? i.name), fehler: failed },
    },
  ]);
  await syncAccounts([...new Set(items.map((i) => i.account_id))]);
  return { ok, failed };
}

/** Logischen Ordner in allen Konten umbenennen (Regel 2: nur auf ausdrücklichen Wunsch). */
export async function renameLogicalFolder(folder: LogicalFolder, name: string): Promise<void> {
  const parts = await fetchFolderParts(folder.path);
  for (const p of parts) await updateItem(p.account_id, p.drive_id, { name });
  const parentPath = folder.path.split("/").slice(0, -1).join("/");
  const newPath = childPath(parentPath, name);
  await movePathPrefs(folder.key, newPath.toLowerCase()).catch(() => undefined);
  await writeLog("rename", `Ordner „${folder.path}“ → „${name}“`, { konten: parts.length });
  await syncAccounts([...new Set(parts.map((p) => p.account_id))]);
}

/**
 * Logischen Ordner verschieben: jeder Teil bleibt in seinem Konto und wandert dort unter den Zielpfad
 * (fehlende Zielordner werden im selben Konto angelegt). Es wird nichts kopiert.
 */
export async function moveLogicalFolder(folder: LogicalFolder, target: Crumb, accounts: Account[]): Promise<void> {
  const tk = target.key;
  if (tk === folder.key || tk.startsWith(folder.key + "/")) throw new Error("Ein Ordner kann nicht in sich selbst verschoben werden");
  if (crossesSealed(folder.path, childPath(target.path, folder.name))) throw new Error(SEALED_MESSAGE);
  const parts = await fetchFolderParts(folder.path);
  const resolver = new PathResolver(accounts);
  for (const p of parts) {
    if (!p.parent_drive_id) throw new Error("Ursprungsordner unbekannt");
    const parent = await resolver.ensure(p.account_id, pathSegments(target.path));
    if (parent !== p.parent_drive_id) await moveWithin(p.account_id, p.drive_id, parent, p.parent_drive_id);
  }
  await movePathPrefs(folder.key, childPath(target.path, folder.name).toLowerCase()).catch(() => undefined);
  await writeLog("move", `Ordner „${folder.path}“ nach „${target.path || "Drive"}“ verschoben`, { konten: parts.length, created: resolver.created });
  await syncAccounts([...new Set(parts.map((p) => p.account_id))]);
}

/** Einstellungen, die am Pfad hängen (Farbe, Sperre, Gruppenregel), beim Umbenennen/Verschieben mitnehmen. */
export async function movePathPrefs(fromKey: string, toKey: string): Promise<void> {
  const swap = (k: string) => (k === fromKey || k.startsWith(fromKey + "/") ? toKey + k.slice(fromKey.length) : null);
  await moveFolderHues(fromKey, toKey);
  const { data: locks } = await supabase.from("folder_locks").select("path_key");
  for (const l of locks ?? []) {
    const n = swap(l.path_key as string);
    if (!n) continue;
    await supabase.from("folder_locks").delete().eq("path_key", l.path_key);
    await supabase.from("folder_locks").upsert({ path_key: n }, { onConflict: "owner_id,path_key" });
  }
  const { data: st } = await supabase.from("settings").select("owner_id, group_folder").maybeSingle();
  const g = st?.group_folder ? swap(st.group_folder as string) : null;
  if (st && g) await supabase.from("settings").update({ group_folder: g }).eq("owner_id", st.owner_id);
}
