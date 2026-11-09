// Vorschaubilder-Speicher auf dem Gerät begrenzen (getestet in thumbEvict.test.ts).
// Bisher kam jedes je angesehene Bild dazu und nichts ging wieder weg – auch nicht von gelöschten Fotos.
// Wird der Speicher der App zu gross, räumt iOS irgendwann alles auf einmal ab (samt KI-Index).

/** Bis zu dieser Kantenlänge gilt ein Bild als kleines Raster-Bild (≈ 15 KB), darüber als grosse Ansicht (≈ 250 KB). */
const SMALL_MAX = 640;

/** Höchstens so viele Bilder bleiben auf dem Gerät: Raster ≈ 250 MB, grosse Ansicht ≈ 150 MB. */
export const THUMB_LIMITS = { small: 16_000, large: 600 };

/** Kantenlänge aus der Cache-Adresse „…/__thumbs/<konto>/<datei>/<grösse>“. */
function sizeOf(url: string): number {
  const n = Number(url.slice(url.lastIndexOf("/") + 1));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Welche Einträge müssen weg? `urls` in der Reihenfolge, in der sie gespeichert wurden (älteste zuerst) –
 * so liefert sie der Browser. Pro Grössenklasse bleiben die neuesten bis zur Obergrenze.
 */
export function pickEvictions(urls: readonly string[], limits = THUMB_LIMITS): string[] {
  const small: string[] = [];
  const large: string[] = [];
  for (const u of urls) (sizeOf(u) <= SMALL_MAX ? small : large).push(u);
  return [...small.slice(0, Math.max(0, small.length - limits.small)), ...large.slice(0, Math.max(0, large.length - limits.large))];
}
