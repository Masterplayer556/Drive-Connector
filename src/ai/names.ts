// KI-SUCHE (Test): Namen lernen („Luca“, „Pikachu“, eigene Figuren).
// Das Bildmodell kennt keine Namen. Statt dessen merkt sich die Suche, welche Fotos du bei einem Namen
// mit 👍 bewertet hast (oder in der Foto-Ansicht so benannt hast), und sucht nach Fotos, die diesen ähnlich
// sehen. Klappt am besten bei Figuren mit festem Aussehen (gezeichnet, Kostüm, Plüschtier …).
// Reine Funktionen (getestet).
import { nameRuns } from "./dict";
import { dot, normalize, rank, type Adjust, type Hit } from "./rank";

export interface FeedbackLike {
  english: string;
  key: string;
  vote: 1 | -1;
}

export interface LearnedName {
  /** klein geschrieben */
  name: string;
  /** So geschrieben, wie du ihn zuletzt eingegeben hast */
  label: string;
  /** Fotos mit 👍 */
  keys: string[];
}

/** Alle gelernten Namen: aus jeder 👍-Bewertung einer Suche, in der ein Name vorkommt. */
export function learnedNames(feedback: (FeedbackLike & { at?: number })[]): Map<string, LearnedName> {
  const out = new Map<string, LearnedName>();
  const sorted = [...feedback].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  for (const f of sorted) {
    if (f.vote !== 1) continue;
    for (const { name, label } of nameRuns(f.english)) {
      const n = out.get(name) ?? { name, label, keys: [] };
      n.label = label;
      if (!n.keys.includes(f.key)) n.keys.push(f.key);
      out.set(name, n);
    }
  }
  return out;
}

/** Mittelwert der Fotos – „so sieht X aus“. null, wenn keines davon gelernt ist. */
export function prototypeOf(keys: string[], vectors: Map<string, Float32Array>): Float32Array | null {
  let sum: Float32Array | null = null;
  for (const k of keys) {
    const v = vectors.get(k);
    if (!v) continue;
    sum ??= new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) sum[i] += v[i];
  }
  return sum ? normalize(sum) : null;
}

/**
 * Fotos, die wie die gelernten Fotos des Namens aussehen.
 * Bild zu Bild: gleiche Figur ≈ 0.8–0.95, Unpassendes ≈ 0.5–0.7. Die 👍-Fotos selbst sind immer dabei.
 */
export function rankByName(
  proto: Float32Array,
  keys: string[],
  vectors: Map<string, Float32Array>,
  { limit = 60, adjust }: { limit?: number; adjust?: Adjust } = {},
): Hit[] {
  const liked = new Set(keys);
  const hits = rank(proto, vectors, { limit: limit + keys.length, floor: 0.7, window: 0.2, adjust });
  const seen = new Set(hits.map((h) => h.key));
  // Gelobte Fotos immer zeigen, auch wenn sie etwas anders aussehen als der Durchschnitt
  for (const k of keys) {
    const v = vectors.get(k);
    if (v && !seen.has(k) && !adjust?.hide.has(k)) hits.push({ key: k, score: dot(proto, v) });
  }
  return hits
    .sort((a, b) => Number(liked.has(b.key)) - Number(liked.has(a.key)) || b.score - a.score)
    .slice(0, limit);
}
