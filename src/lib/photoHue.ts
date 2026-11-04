// Ordnerfarbe aus den Fotos: welcher Farbton herrscht vor? Reine Funktionen (getestet).
//
// Kein einfacher Durchschnitt der Farben – der wird fast immer graubraun. Stattdessen zählt jeder Bildpunkt
// für seinen Farbton, gewichtet nach Sättigung und Helligkeit (kräftige Farben zählen viel, Grau/Schwarz/Weiss
// gar nicht). Gewinner ist der Farbton mit dem meisten Gewicht.

const BINS = 36; // je 10°

/** RGB (0–255) → Farbton (0–360), Sättigung und Helligkeit (0–1). */
export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

/** Farbton-Verteilung eines Bildes (RGBA-Bildpunkte, z. B. aus getImageData). */
export function hueHistogram(rgba: ArrayLike<number>): { bins: Float64Array; total: number } {
  const bins = new Float64Array(BINS);
  let total = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue; // durchsichtig
    total++;
    const { h, s, v } = rgbToHsv(rgba[i], rgba[i + 1], rgba[i + 2]);
    if (s < 0.2 || v < 0.15) continue; // grau, schwarz, weiss
    bins[Math.floor(h / (360 / BINS)) % BINS] += s * v;
  }
  return { bins, total };
}

/**
 * Vorherrschender Farbton mehrerer Bilder. Jedes Foto mit genug Farbe hat eine Stimme (verteilt auf seine
 * Farbtöne) – sonst entscheidet ein einziges knallbuntes Foto. null = zu wenige Fotos mit Farbe
 * (dann bleibt die Farbe aus dem Namen).
 */
export function dominantHue(
  histograms: { bins: Float64Array; total: number }[],
  { minColor = 0.06, minShare = 0.3 } = {},
): number | null {
  const sum = new Float64Array(BINS);
  let images = 0;
  let colorful = 0;
  for (const { bins, total } of histograms) {
    if (!total) continue;
    images++;
    const color = bins.reduce((a, b) => a + b, 0);
    if (color / total < minColor) continue; // fast ohne Farbe – keine Stimme
    colorful++;
    for (let i = 0; i < BINS; i++) sum[i] += bins[i] / color;
  }
  if (!colorful || colorful / images < minShare) return null;
  // Etwas glätten (Nachbar-Fächer zählen halb), damit ein Farbton an der Fächergrenze nicht verliert
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < BINS; i++) {
    const score = sum[i] + 0.5 * (sum[(i + BINS - 1) % BINS] + sum[(i + 1) % BINS]);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  // Genauer Farbton: gewichteter Mittelwert im Gewinner-Fach und seinen Nachbarn (auf dem Farbkreis)
  let x = 0;
  let y = 0;
  for (const j of [best - 1, best, best + 1]) {
    const k = (j + BINS) % BINS;
    const a = ((k + 0.5) * (360 / BINS) * Math.PI) / 180;
    x += sum[k] * Math.cos(a);
    y += sum[k] * Math.sin(a);
  }
  const h = (Math.atan2(y, x) * 180) / Math.PI;
  return Math.round((h + 360) % 360) % 360;
}

/** Neu berechnen? Noch nie, Anzahl Fotos deutlich anders (±20 %) oder älter als 60 Tage. */
export function needsUpdate(saved: { photos: number; at: number } | undefined, photos: number, now = Date.now()): boolean {
  if (!saved) return true;
  if (Math.abs(saved.photos - photos) > Math.max(3, saved.photos * 0.2)) return true;
  return now - saved.at > 60 * 864e5;
}
