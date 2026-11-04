import { describe, expect, it } from "vitest";
import { looksEnglish, toEnglish } from "./dict";

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

describe("KI-Suche: Wörterbuch – Endungen, zusammengesetzt, Englisch", () => {
  it("Mehrzahl und Endungen", () => {
    expect(toEnglish("Bergen")).toBe("mountain");
    expect(toEnglish("Rosen im Garten")).toBe("roses in the garden");
  });
  it("zusammengesetzte Wörter", () => {
    expect(toEnglish("Schneeberg")).toBe("snow mountain");
    expect(toEnglish("Hundespielzeug")).toBe("dogs toy");
  });
  it("deutsch bleibt deutsch, auch bei mehrdeutigen Wörtern", () => {
    expect(toEnglish("See")).toBe("lake");
    expect(toEnglish("rot")).toBe("red");
    expect(toEnglish("Bad")).toBe("bathroom");
  });
  it("englische Suche wird erkannt und nicht verfälscht", () => {
    expect(looksEnglish("sunset at the beach")).toBe(true);
    expect(looksEnglish("Hund im Schnee")).toBe(false);
    expect(toEnglish("view of the sea")).toBe("view of the sea");
    expect(toEnglish("I see the lake")).toBe("I see the lake");
    expect(toEnglish("dog on the beach")).toBe("dog on the beach");
  });
  it("gemischt: deutsche Wörter in englischer Suche werden trotzdem übersetzt", () => {
    expect(toEnglish("Hund on the beach")).toBe("dog on the beach");
  });
  it("Schweizer Wörter", () => {
    expect(toEnglish("Velo")).toBe("bicycle");
    expect(toEnglish("Gipfeli")).toBe("croissant");
  });
});

describe("KI-Suche: Englisch besser erkennen", () => {
  it("einzelne englische Wörter und Suchen ohne Füllwörter", () => {
    expect(looksEnglish("dog")).toBe(true);
    expect(looksEnglish("sunset beach")).toBe(true);
    expect(looksEnglish("red car snow")).toBe(true);
    expect(toEnglish("dog")).toBe("dog");
    expect(toEnglish("red car snow")).toBe("red car snow");
  });
  it("deutsche Suchen bleiben deutsch", () => {
    expect(looksEnglish("Hund")).toBe(false);
    expect(looksEnglish("Hund Schnee")).toBe(false);
    expect(looksEnglish("See")).toBe(false);
    expect(looksEnglish("Velo")).toBe(false);
    expect(toEnglish("Kind am See")).toBe("child at the lake");
  });
  it("englische Wörter, die auch deutsch sind, behalten in englischen Suchen ihre Bedeutung", () => {
    expect(toEnglish("kind dog")).toBe("kind dog");
    expect(toEnglish("rock concert")).toBe("rock concert");
    expect(toEnglish("birthday gift")).toBe("birthday gift");
  });
});
