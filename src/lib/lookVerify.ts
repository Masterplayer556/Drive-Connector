// Feinprüfung für „Sieht gleich aus“-Gruppen mit Screenshots/Grafiken (reine Funktionen, getestet).
// Jedes Foto der Gruppe wird mit dem besten (dem, das bleiben würde) im Feinabbild verglichen:
// - deutlich anders → raus aus der Gruppe (nicht dasselbe Bild)
// - Feinabbild fehlt (Vorschau nicht ladbar) → bleibt drin, aber die Gruppe gilt als „nicht sicher“
//   (keine Vorauswahl zum Löschen)
// Urteile werden pro Paar von Prüfsummen gemerkt – jede Vorschau wird nur einmal gross geladen.
import { needsFine, qualityFirst } from "./duplicates";
import { sameFine } from "./lookalike";
import type { Item } from "./types";

export const pairKey = (a: string, b: string) => (a < b ? `${a}+${b}` : `${b}+${a}`);
export const fineKey = (i: Pick<Item, "account_id" | "drive_id">) => `${i.account_id}|${i.drive_id}`;

/** Ein Foto pro Prüfsumme; das erste ist das beste (bleibt). */
function reps(items: Item[]): Item[] {
  const byMd5 = new Map<string, Item>();
  for (const i of items) if (i.md5 && !byMd5.has(i.md5)) byMd5.set(i.md5, i);
  return [...byMd5.values()].sort(qualityFirst);
}

/** Fotos, deren Feinabbild noch gebraucht wird (Urteil noch nicht bekannt). */
export function fineTodo(groups: Item[][], cache: Map<string, boolean>): Item[] {
  const out = new Map<string, Item>();
  for (const items of groups) {
    if (!items.some(needsFine)) continue;
    const [ref, ...rest] = reps(items);
    for (const r of rest) {
      if (cache.has(pairKey(ref.md5!, r.md5!))) continue;
      out.set(fineKey(ref), ref);
      out.set(fineKey(r), r);
    }
  }
  return [...out.values()];
}

export interface Checked {
  items: Item[];
  /** Mindestens ein Foto liess sich nicht genau vergleichen */
  unsure: boolean;
}

/** Gruppen nach der Feinprüfung (null = keine Gruppe mehr). Neue Urteile landen in `cache`. */
export function applyFine(groups: Item[][], fine: Map<string, Uint8Array>, cache: Map<string, boolean>): (Checked | null)[] {
  return groups.map((items) => {
    if (!items.some(needsFine)) return { items, unsure: false };
    const [ref, ...rest] = reps(items);
    const keep = new Set([ref.md5!]);
    let unsure = false;
    for (const r of rest) {
      const k = pairKey(ref.md5!, r.md5!);
      let same = cache.get(k);
      if (same === undefined) {
        const a = fine.get(fineKey(ref));
        const b = fine.get(fineKey(r));
        if (a && b) {
          same = sameFine(a, b);
          cache.set(k, same);
        }
      }
      if (same === undefined) unsure = true;
      if (same !== false) keep.add(r.md5!);
    }
    if (keep.size < 2) return null;
    return { items: items.filter((i) => keep.has(i.md5!)), unsure };
  });
}
