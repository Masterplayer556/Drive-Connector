import { describe, expect, it } from "vitest";
import { fullTextQuery, interleave, searchTerms } from "./textSearch";

describe("searchTerms", () => {
  it("trennt Wörter und hält Wortgruppen zusammen", () => {
    expect(searchTerms("  Satz des „Pythagoras“ ")).toEqual(["Satz", "des", '"Pythagoras"']);
    expect(searchTerms('"erster Weltkrieg" 1914')).toEqual(['"erster Weltkrieg"', "1914"]);
  });
});

describe("fullTextQuery", () => {
  it("verknüpft alle Wörter und beschränkt auf eigene Bilder", () => {
    expect(fullTextQuery("Binom Formel")).toBe(
      "fullText contains 'Binom' and fullText contains 'Formel' and mimeType contains 'image/' and trashed = false and 'me' in owners",
    );
  });
  it("maskiert Hochkomma und Backslash", () => {
    expect(fullTextQuery("l'eau")).toContain("fullText contains 'l\\'eau'");
    expect(fullTextQuery("a\\b")).toContain("'a\\\\b'");
  });
  it("leer → keine Abfrage", () => {
    expect(fullTextQuery("   ")).toBeNull();
  });
});

describe("interleave", () => {
  it("mischt nach Rang", () => {
    expect(interleave([[1, 2, 3], [10], [20, 21]])).toEqual([1, 10, 20, 2, 21, 3]);
  });
});
