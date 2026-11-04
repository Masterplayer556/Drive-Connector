// KI-SUCHE (Test): Suchtext → Vektor (auf dem Gerät) → ähnlichste Fotos aus dem lokalen Index.
// Dazu: Feedback (👍/👎), „Ähnliche Fotos“ und Gruppen fast gleicher Fotos – alles nur mit dem Index, ohne Modell.
import type { Item } from "../lib/types";
import { catalog } from "./catalog";
import { embedText } from "./engine";
import { applyFeedback, groupSimilar, rank } from "./rank";
import { allFeedback, allVectors, deleteFeedback, itemKey, putFeedback, type Feedback } from "./store";

export interface AiResult {
  items: Item[];
  /** So hat die KI die Suche verstanden (nach dem Wörterbuch). */
  english: string;
  indexed: number;
  /** Vektor der Suche – für 👍/👎 */
  q: Float32Array;
  /** Bisherige Bewertungen dieser Suche: Foto-Schlüssel → +1/−1 */
  votes: Map<string, 1 | -1>;
}

let vectors: { at: number; map: Map<string, Float32Array> } | null = null;
let feedback: Feedback[] | null = null;

/** Index höchstens alle 30 s neu lesen (er wächst nebenbei). */
async function loadVectors(): Promise<Map<string, Float32Array>> {
  if (!vectors || Date.now() - vectors.at > 30_000) vectors = { at: Date.now(), map: await allVectors() };
  return vectors.map;
}

const feedbackId = (english: string, key: string) => `${english.toLowerCase()}|${key}`;

/** Index ohne die Fotos bestimmter Konten (z. B. private). Schlüssel = "konto/datei". */
function without(map: Map<string, Float32Array>, accounts?: Set<string>): Map<string, Float32Array> {
  if (!accounts?.size) return map;
  return new Map([...map].filter(([k]) => !accounts.has(k.slice(0, k.indexOf("/")))));
}

/** Konten mit der Rolle „Privat“. */
export const privateAccounts = (accounts: { id: string; role: string }[]) =>
  new Set(accounts.filter((a) => a.role === "privat").map((a) => a.id));

export async function aiSearch(query: string, { exclude }: { exclude?: Set<string> } = {}): Promise<AiResult> {
  // Bisherige Bewertungen wirken immer – der Schalter in den Einstellungen blendet nur die 👍/👎-Knöpfe aus
  const [all, fb] = await Promise.all([loadVectors(), feedback ?? allFeedback().catch(() => [])]);
  feedback = fb;
  const map = without(all, exclude);
  const [{ vec, english }, items] = await Promise.all([embedText(query), catalog()]);
  // Feedback dieser und ähnlicher Suchen einrechnen
  const { query: q2, adjust } = applyFeedback(vec, fb, map);
  const hits = rank(q2, map, { limit: 30, adjust }); // wenige Vorschaubilder = wenig Speicher
  const votes = new Map<string, 1 | -1>();
  for (const f of fb) if (f.english.toLowerCase() === english.toLowerCase()) votes.set(f.key, f.vote);
  return {
    items: hits.map((h) => items.get(h.key)).filter((x): x is Item => !!x),
    english,
    indexed: map.size,
    q: vec,
    votes,
  };
}

/** 👍/👎 speichern; null nimmt die Bewertung zurück. */
export async function vote(result: Pick<AiResult, "q" | "english">, item: Item, value: 1 | -1 | null) {
  const key = itemKey(item);
  const id = feedbackId(result.english, key);
  if (value === null) await deleteFeedback(id);
  else await putFeedback({ id, q: result.q, english: result.english, key, vote: value, at: Date.now() });
  feedback = null; // beim nächsten Suchen neu lesen
}

/** Fotos, die diesem am ähnlichsten sehen. null = Foto ist noch nicht gelernt. */
export async function similarTo(item: Item, { exclude }: { exclude?: Set<string> } = {}): Promise<Item[] | null> {
  const [all, items] = await Promise.all([loadVectors(), catalog()]);
  const v = all.get(itemKey(item));
  const map = without(all, exclude);
  if (!v) return null;
  // Bild-zu-Bild: sehr ähnlich ≈ 0.9+, gleiche Art Szene ≈ 0.8, Unpassendes ≈ 0.5–0.7
  const hits = rank(v, map, { limit: 40, floor: 0.72, window: 0.25, skip: itemKey(item) });
  return hits.map((h) => items.get(h.key)).filter((x): x is Item => !!x);
}

/** Gruppen fast gleicher Fotos, die NICHT schon exakt gleich sind (die zeigt die normale Duplikat-Suche). */
export async function similarGroups(): Promise<Item[][]> {
  const [map, items] = await Promise.all([loadVectors(), catalog(true)]);
  // Nach Aufnahmezeit (sonst Name) sortiert: Serienbilder liegen so nebeneinander
  const entries = [...items.values()]
    .filter((it) => map.has(itemKey(it)))
    .sort((a, b) => (a.taken_at ?? "").localeCompare(b.taken_at ?? "") || a.name.localeCompare(b.name))
    .map((it) => ({ key: itemKey(it), vec: map.get(itemKey(it))! }));
  const groups = await groupSimilar(entries);
  return groups
    .map((g) => g.map((k) => items.get(k)).filter((x): x is Item => !!x))
    .filter((g) => g.length > 1 && new Set(g.map((i) => i.md5 ?? i.drive_id)).size > 1);
}
