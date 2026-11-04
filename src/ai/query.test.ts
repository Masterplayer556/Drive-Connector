import { describe, expect, it } from "vitest";
import { inFolder, parseQuery } from "./query";

describe("KI-Suche: Filter im Suchtext", () => {
  it("O: Ordner", () => {
    expect(parseQuery("O: Ferien Strand")).toEqual({ text: "Strand", folder: "Ferien", video: false, tag: null });
    expect(parseQuery("Hund o:Mathe")).toEqual({ text: "Hund", folder: "Mathe", video: false, tag: null });
    expect(parseQuery('O: "Ferien 2024" Strand')).toEqual({ text: "Strand", folder: "Ferien 2024", video: false, tag: null });
    expect(parseQuery("Ordner: Schule Tafel")).toEqual({ text: "Tafel", folder: "Schule", video: false, tag: null });
    expect(parseQuery("O: Ferien")).toEqual({ text: "", folder: "Ferien", video: false, tag: null });
  });
  it("Ohne Filter bleibt alles", () => {
    expect(parseQuery("Hund im Schnee")).toEqual({ text: "Hund im Schnee", folder: null, video: false, tag: null });
    expect(parseQuery("Zoo: Löwe")).toEqual({ text: "Zoo: Löwe", folder: null, video: false, tag: null });
  });
  it("Video", () => {
    expect(parseQuery("Video Strand")).toEqual({ text: "Strand", folder: null, video: true, tag: null });
    expect(parseQuery("Videos vom Geburtstag")).toEqual({ text: "Geburtstag", folder: null, video: true, tag: null });
    expect(parseQuery("Videos")).toEqual({ text: "", folder: null, video: true, tag: null });
    expect(parseQuery("O: Ferien Video")).toEqual({ text: "", folder: "Ferien", video: true, tag: null });
  });
  it("#Tag", () => {
    expect(parseQuery("#Ferien Strand")).toEqual({ text: "Strand", folder: null, video: false, tag: "Ferien" });
    expect(parseQuery('Hund #"Ferien 2024"')).toEqual({ text: "Hund", folder: null, video: false, tag: "Ferien 2024" });
    expect(parseQuery("#Rot")).toEqual({ text: "", folder: null, video: false, tag: "Rot" });
  });
  it("Ordner passt", () => {
    expect(inFolder("Privat/Ferien 2024/Italien/IMG_1.jpg", "ferien")).toBe(true);
    expect(inFolder("Privat/Ferien 2024/Italien/IMG_1.jpg", "Italien")).toBe(true);
    expect(inFolder("Privat/Ferien 2024/Italien/IMG_1.jpg", "ferien 2024/italien")).toBe(true);
    expect(inFolder("Archiv/Mathe/IMG_1.jpg", "Ferien")).toBe(false);
    expect(inFolder("Ferien.jpg", "Ferien")).toBe(false); // Dateiname zählt nicht
  });
});
