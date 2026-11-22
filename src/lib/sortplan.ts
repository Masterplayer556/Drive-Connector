// Sortieren-Knopf (Regel 12): angetippte Fotos ab der höchsten Zahl im Ordner neu nummerieren.
// Fotos, die sich sonst zwischen die neuen Nummern schieben würden (z. B. „9MDID_JJD.png“
// zwischen 9.png und 10.png), bekommen „Foto_“ vorne dran und rutschen damit hinter alle Zahlen.
import { maxNumber, naturalCompare, splitExt } from "./naming";

export interface SortRename {
  id: string;
  from: string;
  to: string;
  /** nummer = angetippt und nummeriert, dazwischen = lag zwischen den neuen Nummern */
  reason: "nummer" | "dazwischen";
}

/**
 * @param ordered angetippte Fotos in der gewünschten Reihenfolge (nur diese werden nummeriert)
 * @param others alle übrigen Fotos im Ordner (auch markierte, aber nicht angetippte) – behalten ihren Namen,
 *               ausser sie würden zwischen den neuen Nummern stehen
 */
export function planSort(
  ordered: { id: string; name: string }[],
  others: { id: string; name: string }[],
): SortRename[] {
  if (!ordered.length) return [];
  const start = maxNumber(others.map((o) => o.name)) + 1;
  const numbered: SortRename[] = ordered.map((f, i) => ({
    id: f.id,
    from: f.name,
    to: `${start + i}${splitExt(f.name).ext}`,
    reason: "nummer",
  }));

  // Bereich der neuen Namen in der Ordner-Sortierung (natürliche Sortierung wie in der Ansicht)
  const sorted = numbered.map((n) => n.to).sort(naturalCompare);
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];

  const taken = new Set([...others.map((o) => o.name), ...numbered.map((n) => n.to)].map((n) => n.toLowerCase()));
  const between: SortRename[] = [];
  for (const o of others) {
    if (naturalCompare(lo, o.name) >= 0 || naturalCompare(o.name, hi) >= 0) continue;
    const { base, ext } = splitExt(o.name);
    let to = `Foto_${base}${ext}`;
    for (let i = 2; taken.has(to.toLowerCase()); i++) to = `Foto_${base}_${i}${ext}`;
    taken.add(to.toLowerCase());
    between.push({ id: o.id, from: o.name, to, reason: "dazwischen" });
  }
  return [...numbered, ...between];
}
