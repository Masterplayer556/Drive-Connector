// KI-SUCHE (Test): Schalter ein/aus. Bewusst winzig und ohne Abhängigkeiten,
// damit der Rest der App ihn nutzen kann, ohne das KI-Modul zu laden.
import { useSyncExternalStore } from "react";

const KEY = "drivepool.ai";

export function aiEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setAiEnabled(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* ignorieren */
  }
  window.dispatchEvent(new Event("drivepool-ai"));
}

/** Für React: neu rendern, wenn der Schalter umgelegt wird. */
export function onAiFlag(cb: () => void): () => void {
  window.addEventListener("drivepool-ai", cb);
  return () => window.removeEventListener("drivepool-ai", cb);
}

/** React-Hook: ist die KI-Suche an? */
export function useAiEnabled(): boolean {
  return useSyncExternalStore(onAiFlag, aiEnabled, () => false);
}

// ---- 👍/👎-Feedback ein/aus (Standard: an) ----
const FEEDBACK_KEY = "drivepool.ai.feedback";

export function feedbackEnabled(): boolean {
  try {
    return localStorage.getItem(FEEDBACK_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setFeedbackEnabled(on: boolean) {
  try {
    if (on) localStorage.removeItem(FEEDBACK_KEY);
    else localStorage.setItem(FEEDBACK_KEY, "0");
  } catch {
    /* ignorieren */
  }
  window.dispatchEvent(new Event("drivepool-ai"));
}

/** React-Hook: 👍/👎-Knöpfe anzeigen? (Bisherige Bewertungen wirken immer.) */
export function useFeedbackEnabled(): boolean {
  return useSyncExternalStore(onAiFlag, feedbackEnabled, () => true);
}

// ---- Modell (Standard oder MobileCLIP zum Testen) ----
const MODEL_KEY = "drivepool.ai.model";

export function aiModel(): "clip" | "mobileclip" {
  try {
    return localStorage.getItem(MODEL_KEY) === "mobileclip" ? "mobileclip" : "clip";
  } catch {
    return "clip";
  }
}

export function setAiModel(m: "clip" | "mobileclip") {
  try {
    if (m === "clip") localStorage.removeItem(MODEL_KEY);
    else localStorage.setItem(MODEL_KEY, m);
  } catch {
    /* ignorieren */
  }
  window.dispatchEvent(new Event("drivepool-ai"));
}

export function useAiModel(): "clip" | "mobileclip" {
  return useSyncExternalStore(onAiFlag, aiModel, () => "clip" as const);
}

// ---- Testordner: das Test-Modell lernt nur Fotos in diesen Ordnern (Name irgendwo im Pfad) ----
const TEST_KEY = "drivepool.ai.testFolders";
export const DEFAULT_TEST_FOLDERS = ["HH", "TLOZ", "Super Mario", "Underrune"];

let testCache: { raw: string | null; list: string[] } | null = null;
export function testFolders(): string[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(TEST_KEY);
  } catch {
    /* ignorieren */
  }
  if (testCache?.raw === raw) return testCache.list; // gleiche Liste → gleiches Objekt (für React)
  let list = DEFAULT_TEST_FOLDERS;
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) list = parsed.filter((x) => typeof x === "string");
  } catch {
    /* ignorieren */
  }
  testCache = { raw, list };
  return list;
}

export function setTestFolders(list: string[]) {
  try {
    localStorage.setItem(TEST_KEY, JSON.stringify(list));
  } catch {
    /* ignorieren */
  }
  window.dispatchEvent(new Event("drivepool-ai"));
}

export function useTestFolders(): string[] {
  return useSyncExternalStore(onAiFlag, testFolders, () => DEFAULT_TEST_FOLDERS);
}

/** Liegt die Datei in einem der Ordner? (Ordnername exakt, Gross/klein egal, irgendwo im Pfad) */
export function inTestFolders(path: string | null, folders: string[]): boolean {
  if (!path || !folders.length) return false;
  const dirs = path.toLowerCase().split("/").slice(0, -1);
  return folders.some((f) => dirs.includes(f.trim().toLowerCase()));
}

// ---- Vergleich: Strichliste, welches Modell besser war ----
const TALLY_KEY = "drivepool.ai.compare";
export interface Tally {
  clip: number;
  mobileclip: number;
  same: number;
}

export function compareTally(): Tally {
  try {
    const t = JSON.parse(localStorage.getItem(TALLY_KEY) ?? "null");
    if (t && typeof t.clip === "number") return t as Tally;
  } catch {
    /* ignorieren */
  }
  return { clip: 0, mobileclip: 0, same: 0 };
}

export function addToTally(winner: keyof Tally): Tally {
  const t = compareTally();
  t[winner]++;
  try {
    localStorage.setItem(TALLY_KEY, JSON.stringify(t));
  } catch {
    /* ignorieren */
  }
  return t;
}

export function resetTally() {
  try {
    localStorage.removeItem(TALLY_KEY);
  } catch {
    /* ignorieren */
  }
}
