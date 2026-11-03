import { describe, expect, it } from "vitest";
import { dot, rank } from "./rank";

const v = (...xs: number[]) => {
  const a = new Float32Array(xs);
  const n = Math.hypot(...xs) || 1;
  return a.map((x) => x / n);
};

describe("KI-Suche: rank", () => {
  it("Skalarprodukt normierter Vektoren", () => {
    expect(dot(v(1, 0), v(1, 0))).toBeCloseTo(1);
    expect(dot(v(1, 0), v(0, 1))).toBeCloseTo(0);
  });

  it("sortiert nach Ähnlichkeit und lässt Unpassendes weg", () => {
    const q = v(1, 0, 0);
    const vectors = new Map([
      ["a", v(0.3, 1, 0)], // ~0.29
      ["b", v(0.35, 1, 0)], // ~0.33 – bester
      ["c", v(0.1, 1, 0)], // ~0.10 – unter der Grenze
    ]);
    expect(rank(q, vectors).map((h) => h.key)).toEqual(["b", "a"]);
  });

  it("nur Treffer nahe am besten", () => {
    const q = v(1, 0);
    const vectors = new Map([
      ["gut", v(1, 1.5)], // ~0.55
      ["mittel", v(1, 3)], // ~0.32 – zu weit vom besten weg
    ]);
    expect(rank(q, vectors).map((h) => h.key)).toEqual(["gut"]);
  });

  it("begrenzt die Anzahl", () => {
    const q = v(1, 0);
    const vectors = new Map(Array.from({ length: 100 }, (_, i) => [`k${i}`, v(1, 0.01 * i)] as const));
    const hits = rank(q, vectors, { limit: 10 });
    expect(hits).toHaveLength(10);
    expect(hits[0].key).toBe("k0");
  });

  it("leerer Index → keine Treffer", () => {
    expect(rank(v(1, 0), new Map())).toEqual([]);
  });
});
