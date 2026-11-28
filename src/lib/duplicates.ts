// Duplikate: welche Kopien sollen weg? Reine Funktionen (getestet).
//
// Fokus: (1) mehrere Kopien im selben Ordner → eine bleibt, die anderen weg;
// (2) Ausnahme: Kopien direkt im Ordner „Random“ (nicht in Unterordnern davon), wenn das Foto auch anderswo
//     liegt → die Random-Kopie weg. Unterordner von Random („Random/Favorites“) zählen wie normale Ordner.
// Kopien in verschiedenen (normalen) Ordnern bleiben – die gehören oft bewusst in mehrere Ordner.
// Dieselben Regeln gelten für Fotos, die nur gleich aussehen (andere Datei, siehe lookalike.ts).
import { isScreenshot } from "./screenshot";
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

const pixels = (i: Item) => (i.width ?? 0) * (i.height ?? 0);

/**
 * Wie „ursprünglich“ ist das Dateiformat? Fotos: HEIC/JPEG kommen von der Kamera, PNG/WebP sind meist
 * umgewandelte Kopien. Screenshots: umgekehrt – das Original ist PNG, ein JPEG davon ist neu komprimiert.
 */
function formatRank(i: Item): number {
  const m = (i.mime_type ?? "").toLowerCase();
  if (isScreenshot(i)) return m === "image/png" ? 0 : 1;
  if (m === "image/heic" || m === "image/heif") return 0;
  if (m === "image/jpeg") return 1;
  return 2;
}

/**
 * Für Fotos, die nur gleich aussehen (andere Datei): welche ist die beste? Zuerst die höhere Auflösung
 * (Pixel, nicht Dateigrösse – eine PNG-Kopie ist grösser, aber nicht besser), dann das Originalformat,
 * dann die mit Aufnahmedatum (Metadaten erhalten), dann die grössere Datei, dann der kürzere Name.
 */
export function qualityFirst(a: Item, b: Item): number {
  const pa = pixels(a);
  const pb = pixels(b);
  // Fast gleiche Auflösung (±1 %, Runden beim Umrechnen) zählt als gleich
  if (pa && pb && Math.abs(pa - pb) > 0.01 * Math.max(pa, pb)) return pb - pa;
  if (!pa !== !pb) return pa ? -1 : 1;
  return (
    formatRank(a) - formatRank(b) ||
    Number(!a.taken_at) - Number(!b.taken_at) ||
    (b.size ?? 0) - (a.size ?? 0) ||
    better(a, b)
  );
}

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

/**
 * Braucht die Feinprüfung? Screenshots und PNG-Grafiken: dort stecken die Unterschiede oft in Kleinigkeiten
 * (Uhrzeit, ein Wort, ein Häkchen), die das grobe Abbild nicht sieht.
 */
export const needsFine = (i: Pick<Item, "name" | "mime_type" | "path" | "width" | "height">) =>
  i.mime_type === "image/png" || isScreenshot(i);
