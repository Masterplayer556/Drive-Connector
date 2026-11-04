import { describe, expect, it } from "vitest";
import { frequentConcepts, pickCards, sample } from "./train";

describe("KI trainieren", () => {
  it("mischt sichere und unsichere Fotos, ohne bewertete", () => {
    const ranked = Array.from({ length: 100 }, (_, i) => `k${i}`);
    const cards = pickCards(ranked, new Set(["k0", "k1"]), 6, () => 0);
    expect(cards).toEqual(["k2", "k32", "k3", "k33", "k4", "k34"]);
    expect(pickCards(["a", "b"], new Set(["a"]), 5)).toEqual(["b"]);
  });
});

describe("Häufige Begriffe auf den Fotos", () => {
  const v = (...xs: number[]) => {
    const n = Math.hypot(...xs) || 1;
    return new Float32Array(xs.map((x) => x / n));
  };
  it("zählt pro Foto den besten Begriff", async () => {
    const concepts = [v(1, 0, 0), v(0, 1, 0), v(0, 0, 1)]; // Hund, Strand, Dokument
    const photos = [v(1, 0.1, 0), v(0.9, 0.2, 0), v(1, 0, 0.2), v(0.1, 1, 0), v(0, 0.2, 0.1)];
    const r = await frequentConcepts(concepts, photos, { topK: 1, minShare: 0, yieldEvery: 0 });
    expect(r).toEqual([
      { index: 0, count: 3 },
      { index: 1, count: 2 },
    ]);
  });
  it("Stichprobe", () => {
    expect(sample([1, 2, 3, 4], 2, () => 0).length).toBe(2);
    expect(new Set(sample([1, 2, 3, 4], 4)).size).toBe(4);
  });
});
