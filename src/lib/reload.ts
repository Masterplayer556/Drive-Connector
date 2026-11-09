// Nach einem App-Update kennt die noch offene (alte) Seite Programmteile, die es auf dem Server nicht mehr
// gibt – beim Öffnen z. B. der Statistik schlägt das Nachladen fehl. Dann hilft nur: Seite neu laden.

import { isWorking } from "./wakelock";

const KEY = "drivepool.reloadedAt";
const PAUSE_MS = 60_000;

/** Fehler beim Nachladen eines Programmteils? (Meldungen von Safari, Chrome, Firefox) */
export function isChunkError(e: unknown): boolean {
  const text = `${(e as Error)?.name ?? ""} ${(e as Error)?.message ?? String(e)}`;
  return /dynamically imported module|module script failed|ChunkLoadError|Unable to preload CSS/i.test(text);
}

/** Darf jetzt automatisch neu geladen werden? Höchstens einmal pro Minute – sonst Endlosschleife, wenn der Fehler bleibt. */
export function mayReload(last: number, now: number): boolean {
  return !(last > 0 && now - last < PAUSE_MS);
}

/**
 * Seite neu laden, falls nicht eben erst geschehen – und nie mitten in einem Upload o. ä.
 * (dann bleibt die Fehler-Anzeige mit dem Knopf „Neu laden“ stehen). Ergebnis: wurde neu geladen?
 */
export function reloadOnce(): boolean {
  if (isWorking()) return false;
  try {
    if (!mayReload(Number(sessionStorage.getItem(KEY) ?? 0), Date.now())) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false; // ohne Merker lieber nicht automatisch
  }
  location.reload();
  return true;
}
