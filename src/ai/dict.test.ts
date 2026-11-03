import { describe, expect, it } from "vitest";
import { toEnglish } from "./dict";

describe("KI-Suche: Wörterbuch", () => {
  it("übersetzt typische Suchen", () => {
    expect(toEnglish("Hund im Schnee")).toBe("dog in the snow");
    expect(toEnglish("Arbeitsblatt mit Tabelle")).toBe("worksheet with table chart");
    expect(toEnglish("rotes Auto vor dem Haus")).toBe("red car in front of house");
  });
  it("lässt Unbekanntes stehen (Namen, Englisch, Zahlen)", () => {
    expect(toEnglish("Luca am Strand 2024")).toBe("Luca at the beach 2024");
    expect(toEnglish("dog on beach")).toBe("dog on beach");
  });
  it("Gross/klein und Satzzeichen", () => {
    expect(toEnglish("  KATZE,  Sofa! ")).toBe("cat, sofa!");
  });
});
