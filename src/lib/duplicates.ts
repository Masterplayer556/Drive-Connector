// Duplikate: welche Kopien sollen weg? Reine Funktionen (getestet).
//
// Fokus: (1) mehrere Kopien im selben Ordner → eine bleibt, die anderen weg;
// (2) Ausnahme: Kopien im Ordner „Random“, wenn das Foto auch ausserhalb von Random liegt → die Random-Kopie weg.
// Kopien in verschiedenen (normalen) Ordnern bleiben – die gehören oft bewusst in mehrere Ordner.
import type { Item } from "./types";

export const dupKey = (i: Pick<Item, "account_id" | "drive_id">) => `${i.account_id}|${i.drive_id}`;

const folderOf = (i: Item) => i.parent_key ?? (i.path ?? "").split("/").slice(0, -1).join("/");

/** Liegt im Ordner „Random“ (oder einem Unterordner davon)? */
export function inRandom(i: Pick<Item, "path">): boolean {
  return (i.path ?? "").split("/").slice(0, -1).some((s) => s.trim().toLowerCase() === "random");
}

/** Welche Kopie im selben Ordner bleibt: kürzester Name (ohne „ (1)“ o. ä.), dann alphabetisch. */
const better = (a: Item, b: Item) => a.name.length - b.name.length || a.name.localeCompare(b.name);

/** Vorschlag: diese Kopien entfernen (leer = kein Fokus-Duplikat). */
export function suggestRemoval(items: Item[]): Set<string> {
  const out = new Set<string>();
  // Random-Kopien weg, wenn es das Foto auch woanders gibt
  const outside = items.filter((i) => !inRandom(i));
  if (outside.length) items.filter(inRandom).forEach((i) => out.add(dupKey(i)));
  // Im selben Ordner: eine behalten
  const byFolder = new Map<string, Item[]>();
  for (const i of items) {
    if (out.has(dupKey(i))) continue;
    const f = folderOf(i);
    byFolder.set(f, [...(byFolder.get(f) ?? []), i]);
  }
  for (const list of byFolder.values()) [...list].sort(better).slice(1).forEach((i) => out.add(dupKey(i)));
  return out;
}

/** Wenn nur eine Kopie weg soll: die sinnvollste (Random → doppelt im Ordner → längster Pfad). */
export function pickOne(items: Item[]): string {
  const s = suggestRemoval(items);
  const list = [...items].sort(
    (a, b) =>
      Number(inRandom(b)) - Number(inRandom(a)) ||
      Number(s.has(dupKey(b))) - Number(s.has(dupKey(a))) ||
      (b.path ?? "").length - (a.path ?? "").length,
  );
  return dupKey(list[0]);
}
