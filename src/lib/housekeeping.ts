// Aufräumen im Hintergrund – einmal pro App-Start, erst wenn die App eine Weile ruhig läuft.
import { pruneThumbCache } from "./thumbs";

let started = false;

export function startHousekeeping() {
  if (started) return;
  started = true;
  // Speicher der App als „dauerhaft“ anmelden: sonst darf der Browser bei Platzmangel alles löschen
  // (Vorschaubilder, KI-Index). Kostet nichts; ob es gewährt wird, entscheidet der Browser.
  void navigator.storage?.persist?.().catch(() => false);
  setTimeout(() => void pruneThumbCache(), 30_000);
}
