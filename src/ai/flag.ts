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

/** React-Hook: 👍/👎 anzeigen und Bewertungen in die Suche einrechnen? */
export function useFeedbackEnabled(): boolean {
  return useSyncExternalStore(onAiFlag, feedbackEnabled, () => true);
}
