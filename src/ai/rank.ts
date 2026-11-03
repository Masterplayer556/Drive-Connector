// KI-SUCHE (Test): Treffer nach Ähnlichkeit sortieren. Reine Rechnung, ohne Abhängigkeiten (getestet).

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

/**
 * Beste Treffer. CLIP liefert bei passenden Bildern meist ~0.25–0.35, bei unpassenden ~0.15–0.22.
 * Behalten wird, was über der Mindestgrenze liegt und nicht viel schlechter ist als der beste Treffer.
 */
export function rank(
  query: Float32Array,
  vectors: Map<string, Float32Array>,
  { limit = 60, floor = 0.2, window = 0.07 }: { limit?: number; floor?: number; window?: number } = {},
): Hit[] {
  const hits: Hit[] = [];
  for (const [key, v] of vectors) hits.push({ key, score: dot(query, v) });
  hits.sort((a, b) => b.score - a.score);
  const best = hits[0]?.score ?? 0;
  const min = Math.max(floor, best - window);
  const out: Hit[] = [];
  for (const h of hits) {
    if (h.score < min || out.length >= limit) break;
    out.push(h);
  }
  return out;
}
