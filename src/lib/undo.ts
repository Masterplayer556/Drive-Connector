// „Rückgängig“ nach Verschieben, Umbenennen und Löschen: 10 Sekunden lang eine Leiste unten (wie bei Mail).
import { invalidateAll } from "./cache";
import { syncAccounts, writeLog } from "./db";
import { movePathPrefs, type FolderChange } from "./folders";
import { moveWithin, restoreItem, updateItem } from "./google";
import { childPath } from "./naming";
import { DRIVE_PARALLEL, mapPool } from "./pool";
import type { Crumb, Item, LogicalFolder } from "./types";

export const UNDO_MS = 10_000;

export interface UndoOffer {
  id: number;
  label: string;
  run: () => Promise<void>;
}

type Listener = (u: UndoOffer | null) => void;
const listeners = new Set<Listener>();
let current: UndoOffer | null = null;
let seq = 0;

export function subscribeUndo(fn: Listener): () => void {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}

function emit(u: UndoOffer | null) {
  current = u;
  for (const fn of listeners) fn(u);
}

/** Bietet „Rückgängig“ an (ersetzt ein älteres Angebot). */
export function offerUndo(label: string, run: () => Promise<void>) {
  emit({ id: ++seq, label, run });
}

export function clearUndo(id?: number) {
  if (id === undefined || current?.id === id) emit(null);
}

/** Nach dem Rückgängigmachen: Index abgleichen und Ansichten neu laden. */
async function refresh(accountIds: string[]) {
  if (accountIds.length) await syncAccounts([...new Set(accountIds)]).catch(() => undefined);
  invalidateAll();
  window.dispatchEvent(new Event("drivepool-changed"));
}

const parentCrumb = (path: string): Crumb => {
  const parts = path.split("/");
  parts.pop();
  const p = parts.join("/");
  return { name: parts[parts.length - 1] ?? "Drive", path: p, key: p.toLowerCase() };
};

/* ---------- Bausteine ---------- */

export interface MovedFile {
  item: Item;
  /** neuer Elternordner (Drive-ID im selben Konto) */
  to: string;
  /** beim Verschieben wegen Namenskonflikt umbenannt */
  renamed?: boolean;
}

/** Fotos zurück in ihren alten Ordner (und alten Namen). */
export function undoFileMoves(moved: MovedFile[]): () => Promise<void> {
  return async () => {
    await mapPool(moved, DRIVE_PARALLEL, (m) =>
      moveWithin(
        m.item.account_id,
        m.item.drive_id,
        m.item.parent_drive_id!,
        m.to,
        m.renamed ? { name: m.item.name, description: m.item.description ?? "" } : {},
      ),
    );
    await writeLog("move", `Rückgängig: ${moved.length} Foto${moved.length === 1 ? "" : "s"} zurückverschoben`);
    await refresh(moved.map((m) => m.item.account_id));
  };
}

/**
 * Ordner wieder an den alten Ort: `folder` = Ordner vor dem Verschieben, `target` = wohin er verschoben wurde,
 * `change` = was moveLogicalFolder tatsächlich verschoben hat. Nur diese Teile wandern zurück – lag am Ziel
 * schon ein gleichnamiger Ordner (zusammengeführt), bleibt der, wo er ist.
 */
export function undoFolderMove(folder: LogicalFolder, target: Crumb, change: FolderChange): () => Promise<void> {
  return async () => {
    await mapPool(change.parts, DRIVE_PARALLEL, (p) => moveWithin(p.account_id, p.drive_id, p.from!, p.to!));
    const now = childPath(target.path, folder.name);
    if (!change.merged) await movePathPrefs(now.toLowerCase(), folder.key).catch(() => undefined);
    await writeLog("move", `Rückgängig: Ordner „${now}“ zurück nach „${parentCrumb(folder.path).path || "Drive"}“ verschoben`, {
      konten: change.parts.length,
    });
    await refresh(change.parts.map((p) => p.account_id));
  };
}

/** Ordner zurück auf den alten Namen – nur die umbenannten Teile (nicht einen schon vorhandenen gleichnamigen Ordner). */
export function undoFolderRename(folder: LogicalFolder, newName: string, change: FolderChange): () => Promise<void> {
  return async () => {
    for (const p of change.parts) await updateItem(p.account_id, p.drive_id, { name: folder.name });
    const now = childPath(parentCrumb(folder.path).path, newName);
    if (!change.merged) await movePathPrefs(now.toLowerCase(), folder.key).catch(() => undefined);
    await writeLog("rename", `Rückgängig: Ordner „${now}“ → „${folder.name}“`, { konten: change.parts.length });
    await refresh(change.parts.map((p) => p.account_id));
  };
}

/** Fotos zurück auf den alten Namen (und die alte Beschreibung). In umgekehrter Reihenfolge – wichtig bei Tauschungen. */
export function undoFileRenames(renamed: Item[]): () => Promise<void> {
  return async () => {
    for (const it of [...renamed].reverse()) {
      await updateItem(it.account_id, it.drive_id, { name: it.name, description: it.description ?? "" });
    }
    await writeLog("rename", `Rückgängig: ${renamed.length} Foto${renamed.length === 1 ? "" : "s"} wieder wie vorher benannt`);
    await refresh(renamed.map((i) => i.account_id));
  };
}

/** Gelöschte Fotos aus dem Papierkorb zurückholen. */
export function undoTrash(items: Item[]): () => Promise<void> {
  return async () => {
    await mapPool(items, DRIVE_PARALLEL, (it) => restoreItem(it.account_id, it.drive_id));
    await writeLog("move", `Rückgängig: ${items.length} Foto${items.length === 1 ? "" : "s"} aus dem Papierkorb zurückgeholt`);
    await refresh(items.map((i) => i.account_id));
  };
}

/** Mehrere Rückgängig-Schritte nacheinander (z. B. Ordner und Fotos aus einem Vorgang). */
export function undoAll(steps: (() => Promise<void>)[]): () => Promise<void> {
  return async () => {
    for (const s of [...steps].reverse()) await s();
  };
}
