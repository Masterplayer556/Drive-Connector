import { describe, expect, it } from "vitest";
import { decodeSig, encodeSig, FINE, fineDiff, groupLookalikes, sameFine, sameLook, signature, SOURCE, type Sig } from "./lookalike";

/** Kleiner, fester Zufallsgenerator */
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

type Paint = (x: number, y: number) => [number, number, number];

/** Testbild: weiche Farbflecken (wie ein Foto), aus `seed` */
function photo(seed: number): Paint {
  const r = rng(seed);
  const blobs = Array.from({ length: 7 }, () => ({ x: r(), y: r(), s: 0.08 + r() * 0.25, c: [r() * 255, r() * 255, r() * 255] }));
  return (x, y) => {
    const out: [number, number, number] = [30, 30, 30];
    for (const b of blobs) {
      const w = Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2) / (2 * b.s * b.s));
      for (let i = 0; i < 3; i++) out[i] += w * b.c[i];
    }
    return [Math.min(255, out[0]), Math.min(255, out[1]), Math.min(255, out[2])];
  };
}

/** Abbild eines gemalten Bildes; `noise` = Kompressionsrauschen, `ar` = Seitenverhältnis */
function sigOf(paint: Paint, { noise = 0, seed = 1, ar = 0.75 } = {}): Sig {
  const r = rng(seed);
  const px = new Uint8ClampedArray(SOURCE * SOURCE * 4);
  for (let y = 0; y < SOURCE; y++) {
    for (let x = 0; x < SOURCE; x++) {
      const c = paint((x + 0.5) / SOURCE, (y + 0.5) / SOURCE);
      for (let i = 0; i < 3; i++) px[(y * SOURCE + x) * 4 + i] = c[i] + (r() - 0.5) * 2 * noise;
      px[(y * SOURCE + x) * 4 + 3] = 255;
    }
  }
  return signature(px, ar);
}

describe("Sieht gleich aus", () => {
  it("gleiches Bild, anders komprimiert → gleich", () => {
    for (let s = 1; s <= 8; s++) expect(sameLook(sigOf(photo(s)), sigOf(photo(s), { noise: 6, seed: 99 }))).toBe(true);
  });
  it("verschiedene Bilder → nicht gleich", () => {
    for (let s = 1; s <= 8; s++) expect(sameLook(sigOf(photo(s)), sigOf(photo(s + 20)))).toBe(false);
  });
  it("anderes Format (zugeschnitten) → nicht gleich", () => {
    expect(sameLook(sigOf(photo(3)), sigOf(photo(3), { ar: 1 }))).toBe(false);
    expect(sameLook(sigOf(photo(3)), sigOf(photo(3), { ar: 0.76 }))).toBe(true);
  });
  it("gleiche Zeichnung in anderen Farben → nicht gleich", () => {
    const p = photo(5);
    // Farbkanäle vertauscht, Helligkeit bleibt ähnlich
    const recolor: Paint = (x, y) => {
      const [r, g, b] = p(x, y);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      return [lum * 1.25, lum * 0.95, lum * 0.6];
    };
    expect(sameLook(sigOf(p), sigOf(recolor))).toBe(false);
  });
  it("gespiegelt, heller → nicht gleich", () => {
    const p = photo(6);
    expect(sameLook(sigOf(p), sigOf((x, y) => p(1 - x, y)))).toBe(false);
    expect(sameLook(sigOf(p), sigOf((x, y) => p(x, y).map((v) => Math.min(255, v * 1.15)) as [number, number, number]))).toBe(false);
  });
  it("fast einfarbige Bilder gelten nie als gleich", () => {
    const blank: Paint = () => [250, 250, 250];
    expect(sameLook(sigOf(blank), sigOf(blank, { noise: 2, seed: 4 }))).toBe(false);
  });
  it("Gruppen: nur gleich aussehende, quer über Formate nichts", async () => {
    const entries = [
      { id: "a1", sig: sigOf(photo(1)) },
      { id: "a2", sig: sigOf(photo(1), { noise: 5, seed: 7 }) },
      { id: "a3", sig: sigOf(photo(1), { noise: 5, seed: 8 }) },
      { id: "b1", sig: sigOf(photo(2)) },
      { id: "c1", sig: sigOf(photo(3), { ar: 1.5 }) },
      { id: "c2", sig: sigOf(photo(3), { ar: 1.5, noise: 4, seed: 3 }) },
      { id: "c3", sig: sigOf(photo(3), { ar: 0.5 }) },
    ];
    const groups = await groupLookalikes(entries);
    expect(groups.sort((x, y) => x[0].localeCompare(y[0]))).toEqual([["a1", "a2", "a3"], ["c1", "c2"]]);
  });
  it("Kette (jedes Bild gleicht nur dem nächsten) → keine Riesengruppe, in jeder Gruppe gleichen sich alle", async () => {
    const p = photo(1);
    // 12 Bilder, jedes ein Stück weiter verschoben: Nachbarn gleich, übernächste nicht mehr
    const entries = Array.from({ length: 12 }, (_, k) => ({ id: `k${String(k).padStart(2, "0")}`, sig: sigOf((x, y) => p(x + k * 0.008, y)) }));
    for (let k = 1; k < 12; k++) expect(sameLook(entries[k - 1].sig, entries[k].sig)).toBe(true);
    expect(sameLook(entries[0].sig, entries[2].sig)).toBe(false);
    const groups = await groupLookalikes(entries);
    const sig = new Map(entries.map((e) => [e.id, e.sig]));
    expect(groups.length).toBeGreaterThan(1);
    for (const g of groups) {
      for (const a of g) for (const b of g) if (a !== b) expect(sameLook(sig.get(a)!, sig.get(b)!)).toBe(true);
    }
  });
  it("Gruppen: schnelle Suche (Helligkeits-Fenster) findet dasselbe wie der Vergleich aller Paare", async () => {
    const entries: { id: string; sig: Sig }[] = [];
    for (let s = 1; s <= 30; s++) {
      entries.push({ id: `p${s}`, sig: sigOf(photo(s)) });
      if (s % 3 === 0) entries.push({ id: `p${s}b`, sig: sigOf(photo(s), { noise: 6, seed: s }) });
      // heller/dunkler: knapp innerhalb bzw. ausserhalb der erlaubten Abweichung
      if (s % 5 === 0) entries.push({ id: `p${s}h`, sig: sigOf((x, y) => photo(s)(x, y).map((v) => Math.min(255, v + 2)) as [number, number, number]) });
    }
    const groups = await groupLookalikes(entries);
    const inGroup = new Set(groups.flat());
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (sameLook(entries[i].sig, entries[j].sig)) {
          expect(inGroup.has(entries[i].id)).toBe(true);
          expect(inGroup.has(entries[j].id)).toBe(true);
        }
      }
    }
    expect(groups.some((g) => g.includes("p3") && g.includes("p3b"))).toBe(true);
  });
});

describe("Abbild für den Server", () => {
  it("kodieren und zurück ergibt dasselbe Abbild", () => {
    const sig = sigOf(photo(4), { ar: 1.3333 });
    const back = decodeSig(encodeSig(sig), sig.ar)!;
    expect([...back.g]).toEqual([...sig.g]);
    expect([...back.c]).toEqual([...sig.c]);
    expect(back.ar).toBeCloseTo(1.3333);
  });
  it("kaputter Text → null", () => {
    expect(decodeSig("abc", 1)).toBeNull();
    expect(decodeSig("%%%", 1)).toBeNull();
    expect(decodeSig(encodeSig(sigOf(photo(1))), 0)).toBeNull();
  });
});

describe("Feinprüfung", () => {
  /** Feinabbild einer „Textseite“: Zeilen aus Balken, optional ein Wort anders */
  const page = ({ change = false, noise = 0, seed = 1 } = {}) => {
    const r = rng(seed);
    const g = new Uint8Array(FINE * FINE).fill(250);
    for (let line = 0; line < 20; line++) {
      const y0 = 10 + line * 12;
      for (let w = 0; w < 6; w++) {
        const x0 = 8 + w * 40;
        const len = change && line === 7 && w === 3 ? 12 : 30;
        for (let y = y0; y < y0 + 6; y++) for (let x = x0; x < x0 + len; x++) g[y * FINE + x] = 30;
      }
    }
    if (noise) for (let i = 0; i < g.length; i++) g[i] = Math.max(0, Math.min(255, g[i] + Math.round((r() - 0.5) * 2 * noise)));
    return g;
  };
  it("gleiche Seite, leicht verrauscht → gleich", () => {
    expect(sameFine(page(), page({ noise: 4, seed: 3 }))).toBe(true);
  });
  it("ein Wort anders → nicht gleich (auch wenn das grobe Abbild es nicht sieht)", () => {
    expect(fineDiff(page(), page({ change: true }))).toBeGreaterThan(7);
    expect(sameFine(page(), page({ change: true, noise: 4, seed: 5 }))).toBe(false);
  });
});

