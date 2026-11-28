// Upload-Plan: Duplikate, 15-GB-Grenze, Nummerierung, Zahlen-Schutz und Namenskonflikte.
import { naturalCompare, protectedName, pureNumber, splitExt } from "./naming";

export const FOLDER_LIMIT_BYTES = 15 * 1024 ** 3;

export interface PlanFile {
  id: string;
  name: string;
  size: number;
  md5: string;
}

export type EntryStatus = "upload" | "duplicate" | "conflict" | "limit";
export type RenameReason = "reihenfolge" | "zahlenschutz" | "konflikt" | "dazwischen";

export interface PlanEntry {
  id: string;
  originalName: string;
  targetName: string;
  size: number;
  md5: string;
  status: EntryStatus;
  renamed: RenameReason | null;
  /** Nummer bei Reihenfolge-Upload */
  number: number | null;
  /** Duplikat nur, weil es gleich aussieht wie ein Foto im Zielordner (andere Datei) */
  look?: boolean;
}

export interface PlanInput {
  files: PlanFile[];
  /** Reihenfolge-Upload aktiv (Regel 11) */
  orderMode: boolean;
  /** Vom Nutzer angetippte Reihenfolge (IDs); nur diese werden nummeriert, die übrigen behalten ihren Namen */
  order: string[];
  /** Erste Nummer für den Reihenfolge-Upload */
  startNumber: number;
  /** Namen, die im Zielordner bereits existieren (alle Konten) */
  existingNames: string[];
  /** Prüfsummen, die im Pool schon vorkommen */
  knownMd5: Set<string>;
  /** Duplikate aus anderen Ordnern trotzdem hochladen (Foto gehört in mehrere Ordner) */
  allowPoolDuplicates?: boolean;
  /** Prüfsummen, die im Zielordner selbst schon liegen – die werden immer übersprungen */
  folderMd5?: Set<string>;
  /** Alle Duplikate trotzdem hochladen (auch solche im Zielordner und doppelte in der Auswahl) */
  allowDuplicates?: boolean;
  /** Datei-IDs, die gleich aussehen wie ein Foto im Zielordner oder ein früheres in der Auswahl (andere Datei) */
  lookDup?: Set<string>;
  /** Gesamtgrösse der Fotos, die direkt im Zielordner liegen */
  folderBytes: number;
  folderHasSubfolders: boolean;
  /** Bei Namenskonflikt: überspringen oder mit Foto_Datum-Namen hochladen */
  conflictMode: "skip" | "rename";
  now: Date;
  limitBytes?: number;
}

export function orderedFiles(files: PlanFile[], order: string[]): PlanFile[] {
  const byId = new Map(files.map((f) => [f.id, f]));
  const seen = new Set<string>();
  const out: PlanFile[] = [];
  for (const id of order) {
    const f = byId.get(id);
    if (f && !seen.has(id)) {
      out.push(f);
      seen.add(id);
    }
  }
  for (const f of files) if (!seen.has(f.id)) out.push(f);
  return out;
}

export function planUpload(input: PlanInput): PlanEntry[] {
  const limit = input.limitBytes ?? FOLDER_LIMIT_BYTES;
  const files = input.orderMode ? orderedFiles(input.files, input.order) : input.files;

  const entries: PlanEntry[] = files.map((f) => ({
    id: f.id,
    originalName: f.name,
    targetName: f.name,
    size: f.size,
    md5: f.md5,
    status: "upload",
    renamed: null,
    number: null,
  }));

  // 1. Duplikate (im Pool oder doppelt in der Auswahl)
  const seenMd5 = new Set(input.allowPoolDuplicates ? (input.folderMd5 ?? []) : input.knownMd5);
  if (!input.allowDuplicates) {
    for (const e of entries) {
      if (seenMd5.has(e.md5)) e.status = "duplicate";
      else if (input.lookDup?.has(e.id)) {
        e.status = "duplicate";
        e.look = true;
      } else seenMd5.add(e.md5);
    }
  }

  // 2. Ordner ohne Unterordner: Grenze 15 GB (Regel 4)
  if (!input.folderHasSubfolders) {
    let bytes = input.folderBytes;
    for (const e of entries) {
      if (e.status !== "upload") continue;
      if (bytes + e.size >= limit) e.status = "limit";
      else bytes += e.size;
    }
  }

  // 3. Namen – im Reihenfolge-Modus bekommen nur angetippte Fotos eine Nummer
  const tapped = new Set(input.orderMode ? input.order : []);
  const taken = new Set(input.existingNames.map((n) => n.toLowerCase()));
  let next = input.startNumber;
  for (const e of entries) {
    if (e.status !== "upload") continue;
    if (tapped.has(e.id)) {
      e.number = next;
      e.targetName = `${next}${splitExt(e.originalName).ext}`;
      e.renamed = "reihenfolge";
      next++;
    } else if (pureNumber(e.originalName) !== null) {
      e.targetName = protectedName(e.originalName, input.now, taken);
      e.renamed = "zahlenschutz";
    } else if (taken.has(e.originalName.toLowerCase())) {
      if (input.conflictMode === "rename") {
        e.targetName = protectedName(e.originalName, input.now, taken);
        e.renamed = "konflikt";
      } else {
        e.status = "conflict";
        continue;
      }
    }
    taken.add(e.targetName.toLowerCase());
  }

  // 4. Nicht angetippte Fotos, die sonst zwischen den neuen Nummern stünden
  //    (z. B. „9MDID_JJD.png“ zwischen 9.png und 10.png), bekommen „Foto_“ vorne dran.
  const numbered = entries.filter((e) => e.status === "upload" && e.renamed === "reihenfolge").map((e) => e.targetName);
  if (numbered.length) {
    numbered.sort(naturalCompare);
    const lo = numbered[0];
    const hi = numbered[numbered.length - 1];
    for (const e of entries) {
      if (e.status !== "upload" || e.renamed === "reihenfolge") continue;
      if (naturalCompare(lo, e.targetName) >= 0 || naturalCompare(e.targetName, hi) >= 0) continue;
      const { base, ext } = splitExt(e.targetName);
      let name = `Foto_${base}${ext}`;
      for (let i = 2; taken.has(name.toLowerCase()); i++) name = `Foto_${base}_${i}${ext}`;
      taken.delete(e.targetName.toLowerCase());
      taken.add(name.toLowerCase());
      e.targetName = name;
      e.renamed = "dazwischen";
    }
  }
  return entries;
}

export function summarize(entries: PlanEntry[]) {
  const count = (s: EntryStatus) => entries.filter((e) => e.status === s).length;
  return {
    upload: count("upload"),
    duplicate: count("duplicate"),
    conflict: count("conflict"),
    limit: count("limit"),
    renamed: entries.filter((e) => e.status === "upload" && e.renamed && e.renamed !== "reihenfolge").length,
    numbered: entries.filter((e) => e.status === "upload" && e.renamed === "reihenfolge").length,
  };
}

/** Konflikte, die es ohne Umbenennen gäbe (für die Rückfrage im Upload-Dialog). */
export function conflictCount(input: PlanInput): number {
  return summarize(planUpload({ ...input, conflictMode: "skip" })).conflict;
}
