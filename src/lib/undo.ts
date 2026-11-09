// „Rückgängig“ nach Verschieben und Umbenennen: 10 Sekunden lang eine Leiste unten (wie bei Mail).
import { invalidateAll } from "./cache";
import { syncAccounts, writeLog } from "./db";
import { moveLogicalFolder, renameLogicalFolder } from "./folders";
import { moveWithin, updateItem } from "./google";
import { childKey, childPath } from "./naming";
import type { Account, Crumb, Item, LogicalFolder } from "./types";

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
    for (const m of moved) {
      await moveWithin(
        m.item.account_id,
        m.item.drive_id,
        m.item.parent_drive_id!,
        m.to,
        m.renamed ? { name: m.item.name, description: m.item.description ?? "" } : {},
      );
    }
    await writeLog("move", `Rückgängig: ${moved.length} Foto${moved.length === 1 ? "" : "s"} zurückverschoben`);
    await refresh(moved.map((m) => m.item.account_id));
  };
}

/** Ordner wieder an den alten Ort: `folder` = Ordner vor dem Verschieben, `target` = wohin er verschoben wurde. */
export function undoFolderMove(folder: LogicalFolder, target: Crumb, accounts: Account[]): () => Promise<void> {
  return async () => {
    const now: LogicalFolder = { key: childKey(target.key, folder.name), name: folder.name, path: childPath(target.path, folder.name), parts: [] };
    await moveLogicalFolder(now, parentCrumb(folder.path), accounts); // schreibt selbst ins Protokoll und gleicht ab
    await refresh([]);
  };
}

/** Ordner zurück auf den alten Namen. */
export function undoFolderRename(folder: LogicalFolder, newName: string): () => Promise<void> {
  return async () => {
    const parent = parentCrumb(folder.path);
    const now: LogicalFolder = { key: childKey(parent.key, newName), name: newName, path: childPath(parent.path, newName), parts: [] };
    await renameLogicalFolder(now, folder.name);
    await refresh([]);
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

/** Mehrere Rückgängig-Schritte nacheinander (z. B. Ordner und Fotos aus einem Vorgang). */
export function undoAll(steps: (() => Promise<void>)[]): () => Promise<void> {
  return async () => {
    for (const s of [...steps].reverse()) await s();
  };
}
