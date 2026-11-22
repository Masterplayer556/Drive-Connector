import { describe, expect, it } from "vitest";
import { planSort } from "./sortplan";

const f = (id: string, name: string) => ({ id, name });

describe("planSort", () => {
  it("zählt ab der höchsten Zahl der übrigen Fotos weiter (ohne Nullen)", () => {
    const r = planSort([f("a", "IMG_9.jpg"), f("b", "x.png")], [f("o1", "0080.png"), f("o2", "3.png"), f("o3", "Foto.png")]);
    expect(r.map((x) => x.to)).toEqual(["81.jpg", "82.png"]);
  });
  it("angetippte Fotos zählen nicht zur höchsten Zahl", () => {
    const r = planSort([f("a", "0080.png")], [f("o1", "1.png"), f("o2", "2.png")]);
    expect(r[0].to).toBe("3.png");
  });
  it("startet bei 1 ohne nummerierte Fotos", () => {
    expect(planSort([f("a", "a.heic")], [])[0].to).toBe("1.heic");
  });
  it("nur angetippte werden nummeriert, der Rest bleibt", () => {
    const ordered = Array.from({ length: 10 }, (_, i) => f(`s${i}`, `IMG_${i}.png`));
    const r = planSort(ordered, [f("o1", "Urlaub.png"), f("o2", "IMG_99.png")]);
    expect(r.map((x) => x.to)).toEqual(["1.png", "2.png", "3.png", "4.png", "5.png", "6.png", "7.png", "8.png", "9.png", "10.png"]);
    expect(r.every((x) => x.reason === "nummer")).toBe(true);
  });
  it("benennt Fotos um, die zwischen den neuen Nummern stehen würden", () => {
    const ordered = Array.from({ length: 10 }, (_, i) => f(`s${i}`, `IMG_${i}.png`));
    const r = planSort(ordered, [f("o1", "9MDID_JJD.png"), f("o2", "3a.jpg"), f("o3", "10b.png"), f("o4", "Urlaub.png")]);
    const between = r.filter((x) => x.reason === "dazwischen");
    expect(between.map((x) => [x.from, x.to])).toEqual([
      ["9MDID_JJD.png", "Foto_9MDID_JJD.png"],
      ["3a.jpg", "Foto_3a.jpg"],
    ]);
  });
  it("vermeidet doppelte Namen beim Umbenennen", () => {
    const r = planSort([f("a", "x.png"), f("b", "y.png")], [f("o1", "1a.png"), f("o2", "Foto_1a.png")]);
    expect(r.find((x) => x.id === "o1")?.to).toBe("Foto_1a_2.png");
  });
  it("ohne angetippte Fotos passiert nichts", () => {
    expect(planSort([], [f("o1", "5a.png")])).toEqual([]);
  });
});
