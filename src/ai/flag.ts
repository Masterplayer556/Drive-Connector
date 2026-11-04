// KI-SUCHE: Schalter ein/aus. Bewusst winzig und ohne Abhängigkeiten,
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
    if (v === "mobileclipB") return "mobileclip2b"; // MobileCLIP-B wurde entfernt – MobileCLIP2-B ist der Nachfolger
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

// ---- Kombi: beim Test-Modell zusätzlich das Standard-Modell fragen und zusammenrechnen (Standard: an) ----
const KOMBI_KEY = "drivepool.ai.kombi";

export function kombi(): boolean {
  try {
    return localStorage.getItem(KOMBI_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setKombi(on: boolean) {
  try {
    if (on) localStorage.removeItem(KOMBI_KEY);
    else localStorage.setItem(KOMBI_KEY, "0");
  } catch {
    /* ignorieren */
  }
  window.dispatchEvent(new Event("drivepool-ai"));
}

export function useKombi(): boolean {
  return useSyncExternalStore(onAiFlag, kombi, () => true);
}
