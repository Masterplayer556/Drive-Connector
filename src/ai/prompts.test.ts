import { describe, expect, it } from "vitest";
import { keywordPrompt, promptsFor, stripPhotoWords } from "./prompts";

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
