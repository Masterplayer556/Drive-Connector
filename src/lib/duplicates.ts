// Duplikate: welche Kopien sollen weg? Reine Funktionen (getestet).
//
// Fokus: (1) mehrere Kopien im selben Ordner → eine bleibt, die anderen weg;
// (2) Ausnahme: Kopien direkt im Ordner „Random“ (nicht in Unterordnern davon), wenn das Foto auch anderswo
//     liegt → die Random-Kopie weg. Unterordner von Random („Random/Favorites“) zählen wie normale Ordner.
// Kopien in verschiedenen (normalen) Ordnern bleiben – die gehören oft bewusst in mehrere Ordner.
// Dieselben Regeln gelten für Fotos, die nur gleich aussehen (andere Datei, siehe lookalike.ts).
import type { Item } from "./types";

export const dupKey = (i: Pick<Item, "account_id" | "drive_id">) => `${i.account_id}|${i.drive_id}`;

const folderOf = (i: Item) => i.parent_key ?? (i.path ?? "").split("/").slice(0, -1).join("/");

/** Liegt direkt im Ordner „Random“ (…/Random/foto.jpg)? Unterordner von Random zählen nicht. */
export function inRandom(i: Pick<Item, "path">): boolean {
  const parts = (i.path ?? "").split("/");
  return parts.length >= 2 && parts[parts.length - 2].trim().toLowerCase() === "random";
}

/** Welche Kopie im selben Ordner bleibt: kürzester Name (ohne „ (1)“ o. ä.), dann alphabetisch. */
const better = (a: Item, b: Item) => a.name.length - b.name.length || a.name.localeCompare(b.name);

/** Für Fotos, die nur gleich aussehen (andere Datei): die grösste Datei behalten – meist die beste Qualität. */
export const biggerFirst = (a: Item, b: Item) => (b.size ?? 0) - (a.size ?? 0) || better(a, b);

/** Schlüssel einer „Sieht gleich aus“-Gruppe (aus den Prüfsummen ihrer Dateien). */
export const lookKey = (md5s: string[]) => `look:${[...new Set(md5s)].sort().join("+")}`;

/**
 * Vorschlag: diese Kopien entfernen (leer = kein Fokus-Duplikat).
 * `prefer` bestimmt, welche Kopie im selben Ordner bleibt (die erste nach dieser Reihenfolge).
 */
export function suggestRemoval(items: Item[], prefer: (a: Item, b: Item) => number = better): Set<string> {
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
  for (const list of byFolder.values()) [...list].sort(prefer).slice(1).forEach((i) => out.add(dupKey(i)));
  return out;
}

/** Wenn nur eine Kopie weg soll: die sinnvollste (Random → doppelt im Ordner → längster Pfad). */
export function pickOne(items: Item[], prefer?: (a: Item, b: Item) => number): string {
  const s = suggestRemoval(items, prefer);
  const list = [...items].sort(
    (a, b) =>
      Number(inRandom(b)) - Number(inRandom(a)) ||
      Number(s.has(dupKey(b))) - Number(s.has(dupKey(a))) ||
      (b.path ?? "").length - (a.path ?? "").length,
  );
  return dupKey(list[0]);
}
