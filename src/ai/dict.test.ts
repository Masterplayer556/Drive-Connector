import { describe, expect, it } from "vitest";
import { conceptVocabulary, isNameWord, keywordsOf, nameWords } from "./dict";

describe("KI-Suche: Stichwörter (Englisch)", () => {
  it("erkennt Stichwort-Suchen", () => {
    expect(keywordsOf("dog snow")).toEqual(["dog", "snow"]);
    expect(keywordsOf("dog, snow, mountains")).toEqual(["dog", "snow", "mountains"]);
    expect(keywordsOf("ice beach 2024")).toEqual(["ice", "beach"]);
  });
  it("Sätze und einzelne Wörter sind keine Stichwort-Suche", () => {
    expect(keywordsOf("dog in the snow")).toEqual([]);
    expect(keywordsOf("dog")).toEqual([]);
    expect(keywordsOf("beach 2024")).toEqual([]);
  });
});

describe("KI-Suche: Namen nur aus unbekannten Wörtern", () => {
  it("englische Wörter und ihre Formen sind keine Namen", () => {
    for (const w of ["dogs", "jumping", "standing", "holding", "painted", "cats", "puppies", "with", "selfie"]) {
      expect(isNameWord(w), w).toBe(false);
    }
  });
  it("Namen bleiben Namen", () => {
    expect(nameWords("Luca holding a dog")).toEqual(["luca"]);
    expect(nameWords("Darth Vader at the beach")).toEqual(["darth vader"]);
  });
});

describe("Begriffe zum Trainieren", () => {
  it("nur Motive, keine Füllwörter/Farben, keine doppelte Mehrzahl", () => {
    const en = new Set(conceptVocabulary().map((c) => c.en));
    expect(en.has("dog")).toBe(true);
    expect(en.has("dogs")).toBe(false);
    expect(en.has("potatoes")).toBe(false);
    expect(en.has("strawberries")).toBe(false);
    expect(en.has("red")).toBe(false);
    expect(en.has("in the")).toBe(false);
    expect(en.size).toBeGreaterThan(400);
  });
});
