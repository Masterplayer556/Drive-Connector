import { describe, expect, it } from "vitest";
import { applyFeedback, dot, fuse, groupSimilar, rank, relatedness } from "./rank";

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

describe("KI-Suche: Feedback", () => {
  const vectors = new Map([
    ["hund1", v(1, 0.1, 0)],
    ["hund2", v(1, 0, 0.1)],
    ["katze", v(0.6, 1, 0)],
  ]);

  it("ohne passendes Feedback bleibt alles gleich", () => {
    const q = v(1, 0, 0);
    const r = applyFeedback(q, [{ q: v(0, 0, 1), key: "katze", vote: 1 }], vectors);
    expect(r.query).toBe(q);
    expect(r.adjust.hide.size).toBe(0);
  });

  it("gleiche Suche: 👎 blendet aus, 👍 schiebt nach oben", () => {
    const q = v(1, 0, 0);
    const r = applyFeedback(
      q,
      [
        { q, key: "hund1", vote: -1 },
        { q, key: "katze", vote: 1 },
      ],
      vectors,
    );
    expect(r.adjust.hide.has("hund1")).toBe(true);
    expect(r.adjust.boost.get("katze")).toBeGreaterThan(0);
    const before = rank(q, vectors, { floor: 0, window: 2 });
    const after = rank(r.query, vectors, { floor: 0, window: 2, adjust: r.adjust });
    expect(after.map((h) => h.key)).not.toContain("hund1");
    const score = (hs: { key: string; score: number }[]) => hs.find((h) => h.key === "katze")!.score;
    expect(score(after)).toBeGreaterThan(score(before) + 0.1);
  });

  it("ähnliche Suche lernt mit (schwächer), ganz andere nicht", () => {
    expect(relatedness(1)).toBe(1);
    expect(relatedness(0.94)).toBeCloseTo(0.5);
    expect(relatedness(0.85)).toBe(0);
  });
});

describe("KI-Suche: ähnliche Duplikate", () => {
  it("gruppiert fast gleiche Fotos, trennt verschiedene", async () => {
    const entries = [
      { key: "a1", vec: v(1, 0, 0) },
      { key: "a2", vec: v(1, 0.05, 0) },
      { key: "b", vec: v(0, 1, 0) },
      { key: "a3", vec: v(1, 0, 0.05) },
      { key: "c", vec: v(0, 0, 1) },
    ];
    const groups = await groupSimilar(entries, { threshold: 0.95, window: 3, yieldEvery: 0 });
    expect(groups.map((g) => g.sort())).toEqual([["a1", "a2", "a3"]]);
  });

  it("vergleicht nur innerhalb des Fensters", async () => {
    const unit = (i: number) => v(...Array.from({ length: 8 }, (_, j) => (j === i ? 1 : 0)));
    const entries = [{ key: "x", vec: unit(0) }, ...Array.from({ length: 5 }, (_, i) => ({ key: `o${i}`, vec: unit(i + 1) })), { key: "y", vec: unit(0) }];
    expect(await groupSimilar(entries, { window: 2, yieldEvery: 0 })).toEqual([]);
  });
});

describe("KI-Suche: 👍 verdrängt keine anderen Treffer", () => {
  it("gleich gute Treffer bleiben, das gelobte Foto steht zuerst", () => {
    const q = v(1, 0);
    const vectors = new Map([
      ["a", v(1, 0.3)],
      ["b", v(1, 0.3)],
      ["c", v(1, 0.3)],
    ]);
    const hits = rank(q, vectors, { adjust: { boost: new Map([["c", 0.08]]), hide: new Set() } });
    expect(hits.map((h) => h.key)).toEqual(["c", "a", "b"]);
  });
});

describe("KI-Suche: Stichwörter", () => {
  it("Fotos mit ALLEN Stichwörtern kommen vor Fotos, die nur eines stark zeigen", () => {
    // Achsen: 0 = Hund, 1 = Schnee, 2 = Rest
    const hund = v(1, 0, 0);
    const schnee = v(0, 1, 0);
    const q = v(1, 0.2, 0); // ganze Suche „Hund Schnee“ – das Modell gewichtet „Hund“ stärker
    const vectors = new Map([
      ["nurHund", v(1, 0, 0.2)],
      ["hundImSchnee", v(0.75, 0.75, 0.2)],
    ]);
    expect(rank(q, vectors, { floor: 0 })[0].key).toBe("nurHund"); // ohne Stichwörter
    expect(rank(q, vectors, { floor: 0, keywords: [hund, schnee] })[0].key).toBe("hundImSchnee");
  });
});

describe("Grenze relativ zur Verteilung (auto)", () => {
  it("findet passende Fotos auch bei insgesamt tiefen Werten", () => {
    const unit = (x: number) => new Float32Array([x, Math.sqrt(1 - x * x)]);
    const q = new Float32Array([1, 0]);
    const map = new Map<string, Float32Array>();
    // 100 unpassende um 0.05, zwei passende bei 0.15 (alles unter der festen Grenze 0.2)
    for (let i = 0; i < 100; i++) map.set(`n${i}`, unit(0.04 + (i % 5) * 0.005));
    map.set("a", unit(0.15));
    map.set("b", unit(0.14));
    expect(rank(q, map)).toEqual([]);
    expect(rank(q, map, { auto: true }).map((h) => h.key)).toEqual(["a", "b"]);
  });
});

describe("Abziehen (negative)", () => {
  it("Bild mit dem Wort als Text rutscht hinter das echte Foto", () => {
    const q = new Float32Array([1, 0, 0]);
    const neg = new Float32Array([0.6, 0.8, 0]); // „das Wort als Text“
    const map = new Map<string, Float32Array>([
      ["echt", new Float32Array([0.3, 0, Math.sqrt(1 - 0.09)])],
      ["schrift", new Float32Array([0.32, 0.9, Math.sqrt(1 - 0.32 ** 2 - 0.81)])],
    ]);
    expect(rank(q, map, { floor: -1, window: 1 })[0].key).toBe("schrift");
    expect(rank(q, map, { floor: -1, window: 1, negative: neg })[0].key).toBe("echt");
  });
});

describe("Kombi (fuse)", () => {
  it("rechnet Modelle mit verschiedener Skala fair zusammen", () => {
    // Modell A: tiefe Werte, Modell B: hohe Werte – beide finden "x" am besten
    const a = new Map<string, number>();
    const b = new Map<string, number>();
    for (let i = 0; i < 50; i++) {
      a.set(`n${i}`, 0.05 + (i % 5) * 0.002);
      b.set(`n${i}`, 0.2 + (i % 5) * 0.004);
    }
    a.set("x", 0.12).set("y", 0.1);
    b.set("x", 0.3).set("z", 0.29);
    const hits = fuse([
      { scores: a, weight: 1 },
      { scores: b, weight: 1 },
    ]);
    expect(hits[0].key).toBe("x");
  });
});

describe("Name + Beschreibung zusammen", () => {
  it("Foto, das nach der Person aussieht UND zur Beschreibung passt, gewinnt", () => {
    const described = new Map([["beides", 0.3], ["nurBeschreibung", 0.32], ["nurPerson", 0.18], ["weder", 0.17], ["x", 0.2], ["y", 0.19]]);
    const person = new Map([["beides", 0.9], ["nurBeschreibung", 0.72], ["nurPerson", 0.93], ["weder", 0.71], ["x", 0.75], ["y", 0.74]]);
    const hits = fuse(
      [
        { scores: described, weight: 1.5 },
        { scores: person, weight: 1 },
      ],
      { limit: 30, zFloor: 0.3, zWindow: 3 },
    ).map((h) => h.key);
    expect(hits[0]).toBe("beides");
    expect(hits).not.toContain("weder");
  });
});
