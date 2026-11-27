// „Fehlgeschlagene nochmals hochladen“: Die Dateien liegen noch im Speicher (solange das Fenster offen ist).
// Vor dem neuen Versuch wird mit dem frisch abgeglichenen Zielordner verglichen – kam eine Datei trotz
// Fehlermeldung doch an (Antwort ging unterwegs verloren), wird sie nicht ein zweites Mal hochgeladen.
import type { PlanEntry } from "./plan";
import type { Crumb } from "./types";

export interface FailedUpload {
  entry: PlanEntry;
  error: string;
  target: Crumb;
  /** Dateien des Stapels (Schlüssel = entry.id) */
  files: Map<string, File>;
}

export interface RetryPlan {
  /** Nochmals hochladen (gleicher Zielname wie geplant) */
  retry: PlanEntry[];
  /** Liegt mit gleichem Namen und gleicher Prüfsumme schon im Ordner – kam also doch an */
  present: PlanEntry[];
  /** Name ist inzwischen von einer anderen Datei belegt – nicht überschreiben */
  blocked: { entry: PlanEntry; error: string }[];
}

export function planRetry(entries: PlanEntry[], folderFiles: { name: string; md5: string | null }[]): RetryPlan {
  const byName = new Map<string, (string | null)[]>();
  for (const f of folderFiles) {
    const k = f.name.toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), f.md5]);
  }
  const out: RetryPlan = { retry: [], present: [], blocked: [] };
  for (const e of entries) {
    const there = byName.get(e.targetName.toLowerCase());
    if (!there) out.retry.push({ ...e, status: "upload" });
    else if (there.includes(e.md5)) out.present.push(e);
    else out.blocked.push({ entry: e, error: `„${e.targetName}“ gibt es inzwischen schon in diesem Ordner` });
  }
  return out;
}

/** Fehlgeschlagene nach Zielordner zusammenfassen (Reihenfolge bleibt erhalten). */
export function groupByTarget(items: FailedUpload[]): { target: Crumb; files: Map<string, File>; entries: PlanEntry[] }[] {
  const groups: { target: Crumb; files: Map<string, File>; entries: PlanEntry[] }[] = [];
  for (const it of items) {
    // Gleicher Ordner, aber anderer Stapel (andere Datei-Map) → eigene Gruppe, sonst kollidieren die IDs
    const existing = groups.find((g) => g.target.key === it.target.key && g.files === it.files);
    if (existing) existing.entries.push(it.entry);
    else groups.push({ target: it.target, files: it.files, entries: [it.entry] });
  }
  return groups;
}
