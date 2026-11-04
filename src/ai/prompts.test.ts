import { describe, expect, it } from "vitest";
import { keywordPrompt, keywordPrompts, promptsFor, searchPrompts, stripPhotoWords, synonymVariants, typographicPrompts } from "./prompts";

describe("KI-Suche: Formulierungen", () => {
  it("mehrere Formulierungen", () => {
    const p = promptsFor("dog in the snow");
    expect(p).toContain("a photo of dog in the snow.");
    expect(p).toContain("dog in the snow.");
    expect(p.length).toBeGreaterThan(3);
  });
  it("kein doppeltes „a photo of“", () => {
    expect(stripPhotoWords("a photo of a dog")).toBe("a dog");
    expect(stripPhotoWords("pictures of cats!")).toBe("cats");
    expect(promptsFor("photo of a dog")[0]).toBe("a photo of a dog.");
    expect(stripPhotoWords("photographer")).toBe("photographer");
  });
  it("Stichwort", () => {
    expect(keywordPrompt("snow")).toBe("a photo of snow.");
  });
});

describe("KI-Suche: Synonyme", () => {
  it("ersetzt einzelne Wörter", () => {
    expect(synonymVariants("dog in the snow")).toEqual(["puppy in the snow", "pet dog in the snow", "dog in the snowfall"]);
    expect(synonymVariants("unknownword")).toEqual([]);
    expect(synonymVariants("red car", 1)).toEqual(["red automobile"]);
  });
  it("Suche und Stichwörter", () => {
    expect(searchPrompts("car")).toContain("a photo of automobile.");
    expect(searchPrompts("car")).toContain("a photo of car.");
    expect(keywordPrompts("beach")).toEqual(["a photo of beach.", "a photo of seaside.", "a photo of shore."]);
  });
});

describe("Geschriebenes Wort abziehen", () => {
  it("für normale Suchen, nicht wenn nach Text gefragt wird", () => {
    expect(typographicPrompts("dog in the snow")[0]).toBe('the word "dog in the snow".');
    expect(typographicPrompts("screenshot of a chat")).toEqual([]);
    expect(typographicPrompts("handwritten notes")).toEqual([]);
  });
});
