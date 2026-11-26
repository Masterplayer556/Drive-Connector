// „Sieht gleich aus“: dasselbe Bild als andere Datei finden (neu gespeichert, andere Auflösung, anders
// komprimiert). Die Prüfsumme (md5) erkennt nur byte-gleiche Dateien – hier wird stattdessen ein winziges
// Abbild jedes Fotos verglichen. Ohne KI, reine Rechnung (getestet).
//
// Pro Foto: 32×32 Graustufen (Struktur), 4×4 Farbe (gleiche Zeichnung in anderen Farben ≠ gleich) und das
// Seitenverhältnis. Zwei Fotos gelten als gleich, wenn Format, Helligkeit, Struktur und Farbe übereinstimmen.

/** Kantenlänge des Graustufen-Abbilds */
export const GRID = 32;
/** Kantenlänge des Farb-Abbilds */
export const COLOR_GRID = 4;
/** So gross muss das Bild fürs Abbild gezeichnet sein (je 2×2 Punkte werden gemittelt) */
export const SOURCE = GRID * 2;

export interface Sig {
  /** GRID×GRID Graustufen, zeilenweise */
  g: Uint8Array;
  /** COLOR_GRID×COLOR_GRID mal RGB */
  c: Uint8Array;
  /** Breite ÷ Höhe */
  ar: number;
}

/**
 * Abbild aus SOURCE×SOURCE Bildpunkten (RGBA, auf Weiss gezeichnet). `ar` = Seitenverhältnis des Originals.
 */
export function signature(rgba: ArrayLike<number>, ar: number): Sig {
  const g = new Uint8Array(GRID * GRID);
  const sums = new Float64Array(COLOR_GRID * COLOR_GRID * 3);
  const cell = SOURCE / COLOR_GRID;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      let lum = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const sx = x * 2 + dx;
          const sy = y * 2 + dy;
          const i = (sy * SOURCE + sx) * 4;
          const r = rgba[i];
          const gr = rgba[i + 1];
          const b = rgba[i + 2];
          lum += 0.299 * r + 0.587 * gr + 0.114 * b;
          const ci = (Math.floor(sy / cell) * COLOR_GRID + Math.floor(sx / cell)) * 3;
          sums[ci] += r;
          sums[ci + 1] += gr;
          sums[ci + 2] += b;
        }
      }
      g[y * GRID + x] = Math.round(lum / 4);
    }
  }
  const c = new Uint8Array(sums.length);
  for (let i = 0; i < sums.length; i++) c[i] = Math.round(sums[i] / (cell * cell));
  return { g, c, ar };
}

// Schwellen – gemessen an ~110 Bildern (Fotos, Textseiten, Strichzeichnungen), je neu komprimiert, halbiert,
// verdoppelt und als PNG: gleiches Bild → Abweichung ≤ 1,5 · Korrelation ≥ 0,994 · Farbe ≤ 1,3.
// Verschiedene Bilder → Abweichung ≥ 4,7 · Korrelation ≤ 0,96 (gleich aufgebaute Textseiten: ≤ 0,77).
/** Seitenverhältnis darf so weit abweichen (Runden beim Verkleinern) */
const AR_TOLERANCE = 0.03;
/** Mittlere Helligkeit (0–255) */
const MEAN_TOLERANCE = 3;
/** Mittlere Abweichung pro Punkt im groben 8×8-Abbild – schneller Vorfilter */
const COARSE_MAD = 2.5;
/** Mittlere Abweichung pro Punkt im 32×32-Abbild */
const MAX_MAD = 2.5;
/** Gleiche Struktur: Korrelation der Graustufen (1 = identisch) */
const MIN_CORRELATION = 0.99;
/** Mittlere Abweichung pro Farbwert im 4×4-Farbabbild (schwarz-weisse Kopie eines Farbfotos ≈ 10 → nicht gleich) */
const MAX_COLOR = 3;
/** Fast einfarbige Bilder (leere Seite, schwarzes Bild) lassen sich so nicht unterscheiden → nie als gleich melden */
const MIN_CONTRAST = 6;

const COARSE = 8;

interface Prepared {
  id: string;
  sig: Sig;
  mean: number;
  /** Standardabweichung der Graustufen */
  dev: number;
  coarse: Uint8Array;
}

function prepare(id: string, sig: Sig): Prepared {
  const g = sig.g;
  let sum = 0;
  for (let i = 0; i < g.length; i++) sum += g[i];
  const mean = sum / g.length;
  let sq = 0;
  for (let i = 0; i < g.length; i++) sq += (g[i] - mean) * (g[i] - mean);
  const coarse = new Uint8Array(COARSE * COARSE);
  const k = GRID / COARSE;
  for (let y = 0; y < COARSE; y++) {
    for (let x = 0; x < COARSE; x++) {
      let s = 0;
      for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) s += g[(y * k + dy) * GRID + x * k + dx];
      coarse[y * COARSE + x] = Math.round(s / (k * k));
    }
  }
  return { id, sig, mean, dev: Math.sqrt(sq / g.length), coarse };
}

const arClose = (a: number, b: number) => Math.abs(a - b) <= AR_TOLERANCE * Math.max(a, b);

function sameLookPrepared(a: Prepared, b: Prepared): boolean {
  if (Math.abs(a.mean - b.mean) > MEAN_TOLERANCE) return false;
  if (a.dev < MIN_CONTRAST || b.dev < MIN_CONTRAST) return false;
  // Grob: bricht bei verschiedenen Bildern nach wenigen Punkten ab
  const coarseLimit = COARSE_MAD * COARSE * COARSE;
  let d = 0;
  for (let i = 0; i < a.coarse.length; i++) {
    d += Math.abs(a.coarse[i] - b.coarse[i]);
    if (d > coarseLimit) return false;
  }
  // Fein: Abweichung und Korrelation über alle Punkte
  const ga = a.sig.g;
  const gb = b.sig.g;
  const madLimit = MAX_MAD * ga.length;
  let mad = 0;
  let cov = 0;
  for (let i = 0; i < ga.length; i++) {
    const x = ga[i];
    const y = gb[i];
    mad += Math.abs(x - y);
    if (mad > madLimit) return false;
    cov += (x - a.mean) * (y - b.mean);
  }
  if (cov / ga.length / (a.dev * b.dev) < MIN_CORRELATION) return false;
  // Farbe
  const ca = a.sig.c;
  const cb = b.sig.c;
  let cd = 0;
  for (let i = 0; i < ca.length; i++) cd += Math.abs(ca[i] - cb[i]);
  return cd <= MAX_COLOR * ca.length;
}

/** Sehen zwei Fotos gleich aus? */
export function sameLook(a: Sig, b: Sig): boolean {
  return arClose(a.ar, b.ar) && sameLookPrepared(prepare("a", a), prepare("b", b));
}

/**
 * Gruppen gleich aussehender Fotos (nur Gruppen ab 2). Verglichen wird nur, was dasselbe Seitenverhältnis hat –
 * so bleibt es auch bei zehntausenden Fotos schnell. `pause` gibt zwischendurch die Oberfläche frei.
 *
 * In einer Gruppe sieht jedes Foto jedem anderen gleich (nicht nur über eine Kette A≈B≈C): sonst landen bei
 * schrittweise veränderten Bildern (Serienbilder, Bearbeitungsstufen) ganz verschiedene Fotos in einer Gruppe,
 * und die Vorauswahl schlägt Fotos zum Löschen vor, die dem behaltenen gar nicht gleichen.
 */
export async function groupLookalikes(entries: { id: string; sig: Sig }[], pause?: () => Promise<void>): Promise<string[][]> {
  const list = entries.map((e) => prepare(e.id, e.sig)).sort((a, b) => a.sig.ar - b.sig.ar);
  const parent = list.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const near = new Map<number, Set<number>>();
  const link = (i: number, j: number) => {
    const s = near.get(i);
    if (s) s.add(j);
    else near.set(i, new Set([j]));
  };
  let work = 0;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const maxAr = a.sig.ar * (1 + AR_TOLERANCE * 1.05);
    for (let j = i + 1; j < list.length && list[j].sig.ar <= maxAr; j++) {
      work++;
      const b = list[j];
      if (!arClose(a.sig.ar, b.sig.ar) || !sameLookPrepared(a, b)) continue;
      link(i, j);
      link(j, i);
      const ra = find(i);
      const rb = find(j);
      if (ra !== rb) parent[rb] = ra;
    }
    if (pause && work > 400_000) {
      work = 0;
      await pause();
    }
  }
  const components = new Map<number, number[]>();
  for (let i = 0; i < list.length; i++) {
    if (!near.has(i)) continue;
    const r = find(i);
    const c = components.get(r);
    if (c) c.push(i);
    else components.set(r, [i]);
  }
  const out: string[][] = [];
  for (const comp of components.values()) {
    const degree = (i: number) => near.get(i)?.size ?? 0;
    // Häufigster Fall: alle gleichen allen → eine Gruppe
    if (comp.every((i) => degree(i) === comp.length - 1)) {
      out.push(comp.map((i) => list[i].id));
      continue;
    }
    // Sonst aufteilen: vom Foto mit den meisten Treffern aus nur Fotos dazunehmen, die allen schon gewählten gleichen
    let rest = [...comp].sort((x, y) => degree(y) - degree(x) || x - y);
    while (rest.length > 1) {
      const group = [rest[0]];
      for (const n of rest.slice(1)) if (group.every((g) => near.get(g)!.has(n))) group.push(n);
      if (group.length > 1) out.push(group.map((i) => list[i].id));
      const taken = new Set(group);
      rest = rest.filter((i) => !taken.has(i));
    }
  }
  return out.map((g) => g.sort());
}
