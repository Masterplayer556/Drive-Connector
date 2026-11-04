// Mehrere Fotos/Ordner auf einmal umbenennen (nur auf ausdrücklichen Wunsch, Regel 2).
// Reine Funktion (getestet in renameplan.test.ts).
import { splitExt } from "./naming";

export interface RenameStep {
  id: string;
  from: string;
  to: string;
  /** Name gibt es im Ordner schon (nur bei einem einzelnen Eintrag möglich) */
  conflict: boolean;
}

/**
 * Neue Namen: ein Eintrag → genau der eingegebene Name, mehrere → „Name 1“, „Name 2“ …
 * Fotos behalten ihre Endung. Nummern, die im Ordner schon vergeben sind, werden übersprungen.
 * `taken`: übrige Namen im Ordner (ohne die umbenannten Einträge).
 */
export function planBatchRename(input: {
  entries: { id: string; name: string }[];
  base: string;
  start?: number;
  taken: string[];
  folders?: boolean;
}): RenameStep[] {
  const base = input.base.trim();
  if (!base || !input.entries.length) return [];
  const taken = new Set(input.taken.map((n) => n.toLowerCase()));
  const nameFor = (e: { name: string }, num: number | null) => {
    const ext = input.folders ? "" : splitExt(e.name).ext;
    const stem = num === null ? base : `${base} ${num}`;
    // Endung schon mit eingetippt („Pink.png“) → nicht doppelt anhängen
    return ext && stem.toLowerCase().endsWith(ext.toLowerCase()) ? stem : stem + ext;
  };

  if (input.entries.length === 1) {
    const e = input.entries[0];
    const to = nameFor(e, null);
    return [{ id: e.id, from: e.name, to, conflict: to.toLowerCase() !== e.name.toLowerCase() && taken.has(to.toLowerCase()) }];
  }

  let num = Math.max(0, Math.floor(input.start ?? 1));
  return input.entries.map((e) => {
    let to = nameFor(e, num++);
    while (taken.has(to.toLowerCase())) to = nameFor(e, num++);
    taken.add(to.toLowerCase());
    return { id: e.id, from: e.name, to, conflict: false };
  });
}
