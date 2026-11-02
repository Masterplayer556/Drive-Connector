// Sortieren-Knopf (Regel 12): markierte Fotos ab der höchsten Zahl im Ordner neu nummerieren.
import { maxNumber, splitExt } from "./naming";

export interface SortRename {
  id: string;
  from: string;
  to: string;
}

/**
 * @param ordered markierte Fotos in der gewünschten Reihenfolge
 * @param otherNames Namen aller übrigen (nicht markierten) Fotos im Ordner
 */
export function planSort(ordered: { id: string; name: string }[], otherNames: string[]): SortRename[] {
  const start = maxNumber(otherNames) + 1;
  return ordered.map((f, i) => ({ id: f.id, from: f.name, to: `${start + i}${splitExt(f.name).ext}` }));
}
