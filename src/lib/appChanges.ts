// App-Updates fürs Protokoll: beim Bauen der App aus der Git-Historie gelesen (vite.config.ts → __APP_CHANGES__).
// So stehen auch alle früheren Merges/Pushes drin, ohne dass etwas in der Datenbank gespeichert wird.
import type { LogEntry } from "./types";

export interface AppChange {
  /** Merge eines Pull Requests oder direkter Push auf main */
  type: "merge" | "push";
  at: string;
  pr: number | null;
  title: string;
  sha: string;
  commits: { at: string; title: string }[];
}

declare const __APP_CHANGES__: AppChange[];

export const APP_CHANGES: AppChange[] = typeof __APP_CHANGES__ !== "undefined" ? __APP_CHANGES__ : [];

/** Als Protokoll-Einträge (Art „app“, negative IDs – kollidieren nicht mit der Datenbank). */
export function appChangeEntries(changes = APP_CHANGES): LogEntry[] {
  return changes.map((c, i) => ({
    id: -1 - i,
    created_at: c.at,
    kind: "app",
    message: c.type === "merge" ? `Merge #${c.pr ?? "?"}: ${c.title}` : `Push: ${c.title}`,
    details: {
      commit: c.sha.slice(0, 7),
      ...(c.commits.length ? { pushes: c.commits.map((x) => `${new Date(x.at).toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" })} · ${x.title}`) } : {}),
    },
  }));
}

/** Datenbank-Einträge und App-Updates zusammen, neueste zuerst. */
export function withAppChanges(entries: LogEntry[], changes = APP_CHANGES): LogEntry[] {
  return [...entries, ...appChangeEntries(changes)].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}
