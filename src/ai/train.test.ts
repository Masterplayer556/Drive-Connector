import { describe, expect, it } from "vitest";
import { collectTerms, pickCards, usefulFolderName } from "./train";

describe("KI trainieren", () => {
  it("brauchbare Ordnernamen", () => {
    expect(usefulFolderName("Pikachu")).toBe(true);
    expect(usefulFolderName("Ferien Italien")).toBe(true);
    expect(usefulFolderName("2024")).toBe(false);
    expect(usefulFolderName("2024-05")).toBe(false);
    expect(usefulFolderName("Archiv")).toBe(false);
    expect(usefulFolderName("IMG_1234")).toBe(false);
  });
  it("Begriffe ohne Doppelte, Ordner mit genug Fotos", () => {
    const terms = collectTerms({
      names: ["Pikachu"],
      folders: new Map([
        ["pikachu", 40],
        ["Ferien", 12],
        ["Klein", 2],
        ["2023", 300],
      ]),
      tags: ["Ferien", "Lustig"],
      searches: ["dog in the snow"],
    });
    expect(terms).toEqual([
      { label: "Pikachu", source: "name" },
      { label: "Ferien", source: "ordner" },
      { label: "Lustig", source: "tag" },
      { label: "dog in the snow", source: "suche" },
    ]);
  });
  it("mischt sichere und unsichere Fotos, ohne bewertete", () => {
    const ranked = Array.from({ length: 100 }, (_, i) => `k${i}`);
    const cards = pickCards(ranked, new Set(["k0", "k1"]), 6, () => 0);
    expect(cards).toEqual(["k2", "k32", "k3", "k33", "k4", "k34"]);
    expect(pickCards(["a", "b"], new Set(["a"]), 5)).toEqual(["b"]);
  });
});
