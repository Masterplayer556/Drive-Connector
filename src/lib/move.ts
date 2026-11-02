// Fotos in einen anderen Ordner verschieben (#10). Ein Foto bleibt immer in seinem Konto –
// fehlt der Zielordner dort, wird der Pfad angelegt (Regel 3, Konzept „Verschieben“).
import { protectedName } from "./naming";
import { FOLDER_LIMIT_BYTES } from "./plan";
import type { Item } from "./types";

export type MoveStatus = "move" | "same" | "conflict" | "limit";

export interface MoveEntry {
  item: Item;
  status: MoveStatus;
  targetName: string;
  renamed: boolean;
}

export function planMove(input: {
  items: Item[];
  /** Pfad des Zielordners (logisch) */
  targetKey: string;
  existingNames: string[];
  targetBytes: number;
  targetHasSubfolders: boolean;
  conflictMode: "skip" | "rename";
  now: Date;
  limitBytes?: number;
}): MoveEntry[] {
  const limit = input.limitBytes ?? FOLDER_LIMIT_BYTES;
  const taken = new Set(input.existingNames.map((n) => n.toLowerCase()));
  let bytes = input.targetBytes;
  return input.items.map((item) => {
    if (item.parent_key === input.targetKey) return { item, status: "same", targetName: item.name, renamed: false };
    let targetName = item.name;
    let renamed = false;
    if (taken.has(item.name.toLowerCase())) {
      if (input.conflictMode === "skip") return { item, status: "conflict", targetName, renamed };
      targetName = protectedName(item.name, input.now, taken);
      renamed = true;
    }
    const size = item.size ?? 0;
    if (!input.targetHasSubfolders && bytes + size >= limit) return { item, status: "limit", targetName, renamed };
    bytes += size;
    taken.add(targetName.toLowerCase());
    return { item, status: "move", targetName, renamed };
  });
}
