import { describe, expect, it } from "vitest";
import { isNameWord, keywordsOf, nameWords } from "./dict";
import { learnedNames, prototypeOf, rankByName } from "./names";

const v = (...xs: number[]) => {
  const n = Math.hypot(...xs) || 1;
  return new Float32Array(xs.map((x) => x / n));
};

describe("KI-Suche: Namen", () => {
  it("erkennt Namen", () => {
    expect(isNameWord("Luca")).toBe(true);
    expect(isNameWord("Pikachu")).toBe(true);
    expect(isNameWord("Hund")).toBe(false);
    expect(isNameWord("dog")).toBe(false);
    expect(isNameWord("im")).toBe(false);
    expect(isNameWord("2024")).toBe(false);
    expect(nameWords("Luca at the beach")).toEqual(["luca"]);
  });
  it("Namen zählen nicht als Stichwort", () => {
    expect(keywordsOf("Luca Strand")).toEqual([]);
    expect(keywordsOf("Luca Strand Sonne")).toEqual(["beach", "sun"]);
  });
  it("sammelt 👍-Fotos je Name, 👎 zählt nicht", () => {
    const names = learnedNames([
      { english: "Luca", key: "a", vote: 1, at: 1 },
      { english: "luca at the beach", key: "b", vote: 1, at: 2 },
      { english: "Luca", key: "c", vote: -1, at: 3 },
      { english: "dog", key: "d", vote: 1, at: 4 },
    ]);
    expect([...names.keys()]).toEqual(["luca"]);
    expect(names.get("luca")!.keys).toEqual(["a", "b"]);
    expect(names.get("luca")!.label).toBe("luca");
  });
  it("findet ähnlich aussehende Fotos und zeigt die gelobten immer", () => {
    const vectors = new Map([
      ["a", v(1, 0.1, 0)],
      ["b", v(1, -0.1, 0)],
      ["gleicheFigur", v(1, 0, 0.3)],
      ["andere", v(0, 1, 0.2)],
    ]);
    const proto = prototypeOf(["a", "b", "fehlt"], vectors)!;
    const keys = rankByName(proto, ["a", "b"], vectors).map((h) => h.key);
    expect(keys.slice(0, 2).sort()).toEqual(["a", "b"]);
    expect(keys).toContain("gleicheFigur");
    expect(keys).not.toContain("andere");
    expect(prototypeOf(["fehlt"], vectors)).toBeNull();
  });
});

describe("KI-Suche: mehrteilige Namen", () => {
  it("aufeinanderfolgende Namenswörter sind ein Name", () => {
    expect(nameWords("Darth Vader am Strand")).toEqual(["darth vader"]);
    expect(nameWords("Luca, Mia")).toEqual(["luca", "mia"]);
    const names = learnedNames([{ english: "Darth Vader", key: "a", vote: 1 }]);
    expect(names.get("darth vader")?.label).toBe("Darth Vader");
  });
});
