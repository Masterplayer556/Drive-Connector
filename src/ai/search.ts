// KI-SUCHE (Test): Suchtext → Vektor (auf dem Gerät) → ähnlichste Fotos aus dem lokalen Index.
import type { Item } from "../lib/types";
import { catalog } from "./catalog";
import { embedText } from "./engine";
import { rank } from "./rank";
import { allVectors } from "./store";

export interface AiResult {
  items: Item[];
  /** So hat die KI die Suche verstanden (nach der Übersetzung). */
  english: string;
  indexed: number;
}

let vectors: { at: number; map: Map<string, Float32Array> } | null = null;

export async function aiSearch(query: string): Promise<AiResult> {
  // Index höchstens alle 30 s neu lesen (er wächst nebenbei)
  if (!vectors || Date.now() - vectors.at > 30_000) vectors = { at: Date.now(), map: await allVectors() };
  const [{ vec, english }, items] = await Promise.all([embedText(query), catalog()]);
  const hits = rank(vec, vectors.map);
  return {
    items: hits.map((h) => items.get(h.key)).filter((x): x is Item => !!x),
    english,
    indexed: vectors.map.size,
  };
}
