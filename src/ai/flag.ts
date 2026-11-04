// KI-SUCHE (Test): Schalter ein/aus. Bewusst winzig und ohne Abhängigkeiten,
// damit der Rest der App ihn nutzen kann, ohne das KI-Modul zu laden.
import { useSyncExternalStore } from "react";
import { isModelId, type ModelId } from "./protocol";

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

export function aiModel(): ModelId {
  try {
    const v = localStorage.getItem(MODEL_KEY);
    return isModelId(v) ? v : "clip";
  } catch {
    return "clip";
  }
}

export function setAiModel(m: ModelId) {
  try {
    if (m === "clip") localStorage.removeItem(MODEL_KEY);
    else localStorage.setItem(MODEL_KEY, m);
  } catch {
    /* ignorieren */
  }
  window.dispatchEvent(new Event("drivepool-ai"));
}

export function useAiModel(): ModelId {
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

// ---- Vergleich: Strichliste je Paarung (links gegen rechts), welches Modell besser war ----
const TALLY_KEY = "drivepool.ai.compare2";
export interface Tally {
  left: number;
  right: number;
  same: number;
}
const pairKey = (a: ModelId, b: ModelId) => `${a}|${b}`;

function readTallies(): Record<string, Tally> {
  try {
    const t = JSON.parse(localStorage.getItem(TALLY_KEY) ?? "null");
    if (t && typeof t === "object") return t as Record<string, Tally>;
  } catch {
    /* ignorieren */
  }
  return {};
}

export function compareTally(a: ModelId, b: ModelId): Tally {
  return readTallies()[pairKey(a, b)] ?? { left: 0, right: 0, same: 0 };
}

export function addToTally(a: ModelId, b: ModelId, winner: keyof Tally): Tally {
  const all = readTallies();
  const t = all[pairKey(a, b)] ?? { left: 0, right: 0, same: 0 };
  t[winner]++;
  all[pairKey(a, b)] = t;
  try {
    localStorage.setItem(TALLY_KEY, JSON.stringify(all));
  } catch {
    /* ignorieren */
  }
  return t;
}

export function resetTally(a: ModelId, b: ModelId) {
  const all = readTallies();
  delete all[pairKey(a, b)];
  try {
    localStorage.setItem(TALLY_KEY, JSON.stringify(all));
  } catch {
    /* ignorieren */
  }
}

// ---- Lern-Gerät: lernt das genaue Modell für alle Geräte (PC). Standard: alles ausser iPhone/iPad ----
const LEARNER_KEY = "drivepool.ai.learner";

export function isAppleMobile(): boolean {
  const nav = navigator as Navigator & { maxTouchPoints?: number };
  return /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1);
}

export function learningDevice(): boolean {
  // iPhone/iPad lernen die PC-Modelle nie (zu wenig Arbeitsspeicher) – nur das Standardmodell scannt dort
  if (isAppleMobile()) return false;
  try {
    const v = localStorage.getItem(LEARNER_KEY);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* ignorieren */
  }
  return !isAppleMobile();
}

export function setLearningDevice(on: boolean) {
  try {
    localStorage.setItem(LEARNER_KEY, on ? "1" : "0");
  } catch {
    /* ignorieren */
  }
  window.dispatchEvent(new Event("drivepool-ai"));
}

export function useLearningDevice(): boolean {
  return useSyncExternalStore(onAiFlag, learningDevice, () => false);
}

// ---- Nur Testordner lernen (Standard: ja) ----
const TEST_ONLY_KEY = "drivepool.ai.testOnly";

export function testOnly(): boolean {
  try {
    return localStorage.getItem(TEST_ONLY_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setTestOnly(on: boolean) {
  try {
    if (on) localStorage.removeItem(TEST_ONLY_KEY);
    else localStorage.setItem(TEST_ONLY_KEY, "0");
  } catch {
    /* ignorieren */
  }
  window.dispatchEvent(new Event("drivepool-ai"));
}

export function useTestOnly(): boolean {
  return useSyncExternalStore(onAiFlag, testOnly, () => true);
}
