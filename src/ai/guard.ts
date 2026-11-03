// KI-SUCHE (Test): Absturz-Merker.
// iOS beendet eine Web-App ohne Vorwarnung, wenn sie zu viel Arbeitsspeicher braucht. Darum wird vor jedem
// speicherhungrigen Schritt notiert, was gerade läuft. Geht die App normal in den Hintergrund, wird die
// Notiz gelöscht. Steht sie beim nächsten Start noch da, ist die App bei genau diesem Schritt abgestürzt.

const KEY = "drivepool.ai.risk";

/** Was gerade läuft: Grafikchip, n Prozessor-Worker oder die Suche. */
export type Risk = "gpu" | `workers:${number}` | "search";

let current: Risk | null = null;

function write(r: Risk | null) {
  try {
    if (r) localStorage.setItem(KEY, r);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignorieren */
  }
}

/** Beim Start: Ist die App letztes Mal bei einem Schritt abgestürzt? (Wird dabei gelöscht.) */
export function takeCrash(): Risk | null {
  try {
    const r = localStorage.getItem(KEY) as Risk | null;
    localStorage.removeItem(KEY);
    return r;
  } catch {
    return null;
  }
}

/** Den gerade laufenden Schritt notieren (null = nichts Riskantes). */
export function setRisk(r: Risk | null) {
  current = r;
  if (document.visibilityState === "visible") write(r);
}

// Normal in den Hintergrund / geschlossen → kein Absturz, Notiz weg. Wieder sichtbar → neu notieren.
document.addEventListener("visibilitychange", () => write(document.visibilityState === "visible" ? current : null));
window.addEventListener("pagehide", () => write(null));
