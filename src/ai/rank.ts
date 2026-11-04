// KI-SUCHE (Test): Rechnen mit den Fingerabdrücken (Vektoren). Reine Funktionen ohne Abhängigkeiten (getestet).

export interface Hit {
  key: string;
  score: number;
}

/** Skalarprodukt – bei normierten Vektoren = Kosinus-Ähnlichkeit. */
export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
}

/** Was das Feedback an einer Suche ändert: Treffer nach oben schieben oder ausblenden. */
export interface Adjust {
  boost: Map<string, number>;
  hide: Set<string>;
}

/**
 * Beste Treffer. CLIP liefert bei passenden Bildern meist ~0.25–0.35, bei unpassenden ~0.15–0.22.
 * Behalten wird, was über der Mindestgrenze liegt und nicht viel schlechter ist als der beste Treffer.
 */
export function rank(
  query: Float32Array,
  vectors: Map<string, Float32Array>,
  {
    limit = 60,
    floor = 0.2,
    window = 0.07,
    adjust,
    skip,
    keywords,
    keywordWeight = 0.35,
    auto = false,
  }: {
    limit?: number;
    floor?: number;
    window?: number;
    adjust?: Adjust;
    skip?: string;
    /** Stichwort-Suche: je ein Vektor pro Stichwort – Fotos, die ALLE zeigen, kommen nach oben */
    keywords?: Float32Array[];
    keywordWeight?: number;
    /**
     * Grenzen relativ zur Verteilung dieser Suche: „gut genug“ = Mittelwert + 2 Standardabweichungen,
     * Fenster = 3 Standardabweichungen (bei CLIP entspricht das etwa 0.07). Für Modelle mit anderer Skala.
     */
    auto?: boolean;
  } = {},
): Hit[] {
  const kw = keywords && keywords.length >= 2 ? keywords : null;
  // Die Grenze „gut genug“ kommt aus der reinen Ähnlichkeit – ein 👍-Bonus schiebt ein Foto nach oben,
  // soll aber die anderen Treffer nicht verdrängen
  const all: (Hit & { base: number })[] = [];
  for (const [key, v] of vectors) {
    if (key === skip || adjust?.hide.has(key)) continue;
    // Stichwörter: das am schlechtesten passende Stichwort zählt mit (alle sollen passen, nicht nur eines)
    const base = kw ? (1 - keywordWeight) * dot(query, v) + keywordWeight * Math.min(...kw.map((k) => dot(k, v))) : dot(query, v);
    all.push({ key, base, score: base + (adjust?.boost.get(key) ?? 0) });
  }
  const best = all.reduce((m, h) => Math.max(m, h.base), -Infinity);
  let lo = floor;
  let win = window;
  if (auto && all.length >= 20) {
    const { mean, sd } = spread(all.map((h) => h.base));
    lo = mean + 2 * sd;
    win = 3 * sd;
  }
  const min = Math.max(lo, best - win);
  return all
    .filter((h) => h.base >= min || h.score >= min + win)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ key, score }) => ({ key, score }));
}

/** Mittelwert und Standardabweichung. */
export function spread(xs: number[]): { mean: number; sd: number } {
  if (!xs.length) return { mean: 0, sd: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return { mean, sd };
}

/** Wie stark eine frühere Suche zur jetzigen passt: gleiche Suche = 1, deutlich andere = 0. */
export function relatedness(sim: number): number {
  return Math.max(0, Math.min(1, (sim - 0.9) / 0.08));
}

/**
 * Feedback anwenden (👍/👎). Die Suche wird zu den gelobten Fotos hin- und von den abgelehnten
 * weggeschoben – auch bei ähnlichen Suchen, gewichtet nach Ähnlichkeit. Bei (fast) gleicher Suche
 * werden 👍-Fotos zusätzlich nach oben geschoben und 👎-Fotos ausgeblendet.
 */
export function applyFeedback(
  query: Float32Array,
  feedback: { q: Float32Array; key: string; vote: 1 | -1 }[],
  vectors: Map<string, Float32Array>,
): { query: Float32Array; adjust: Adjust } {
  const shift = new Float32Array(query.length);
  const adjust: Adjust = { boost: new Map(), hide: new Set() };
  let weight = 0;
  for (const f of feedback) {
    const w = relatedness(dot(query, f.q));
    const v = vectors.get(f.key);
    if (!w || !v) continue;
    weight += w;
    for (let i = 0; i < shift.length; i++) shift[i] += w * f.vote * v[i];
    if (w >= 0.75) {
      if (f.vote < 0) adjust.hide.add(f.key);
      else adjust.boost.set(f.key, (adjust.boost.get(f.key) ?? 0) + 0.08 * w);
    }
  }
  if (!weight) return { query, adjust };
  const q = new Float32Array(query.length);
  for (let i = 0; i < q.length; i++) q[i] = query[i] + (0.6 * shift[i]) / Math.max(1, weight);
  return { query: normalize(q), adjust };
}

/**
 * Gruppen fast gleicher Fotos (Serienbilder, bearbeitete Kopien …). Verglichen wird jedes Foto mit den
 * nächsten `window` Fotos in der gegebenen Reihenfolge (z. B. nach Aufnahmezeit) – sonst wären es bei
 * tausenden Fotos zu viele Vergleiche.
 */
export async function groupSimilar(
  entries: { key: string; vec: Float32Array }[],
  { threshold = 0.95, window = 40, yieldEvery = 400 }: { threshold?: number; window?: number; yieldEvery?: number } = {},
): Promise<string[][]> {
  const parent = entries.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < Math.min(entries.length, i + 1 + window); j++) {
      if (dot(entries[i].vec, entries[j].vec) >= threshold) parent[find(j)] = find(i);
    }
    // Zwischendurch Luft holen, damit die App bedienbar bleibt
    if (yieldEvery && i % yieldEvery === yieldEvery - 1) await new Promise((r) => setTimeout(r, 0));
  }
  const groups = new Map<number, string[]>();
  entries.forEach((e, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), e.key]);
  });
  return [...groups.values()].filter((g) => g.length > 1);
}
