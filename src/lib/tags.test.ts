import { describe, expect, it } from "vitest";
import { cleanTag, countTags, inheritsTag, markerColor } from "./tags";

describe("Tags", () => {
  it("räumt Eingaben auf", () => {
    expect(cleanTag("  #Ferien   2024 ")).toBe("Ferien 2024");
    expect(cleanTag("##")).toBe("");
    expect(cleanTag("x".repeat(50)).length).toBe(40);
  });
  it("Merkzeichen haben Farben", () => {
    expect(markerColor("rot")).toBe("#ef4444");
    expect(markerColor("Ferien")).toBeNull();
  });
  it("zählt Gross/klein zusammen, Merkzeichen zuerst", () => {
    const m = new Map([
      ["a", ["Ferien", "Blau"]],
      ["b", ["ferien", "Rot"]],
      ["c", ["Schule"]],
    ]);
    expect(countTags(m).map((t) => `${t.tag}:${t.count}`)).toEqual(["Rot:1", "Blau:1", "Ferien:2", "Schule:1"]);
  });
});

describe("Ordner-Tags", () => {
  const folders = [{ tag: "Pikachu", path: "Privat/Figuren/Pikachu" }];
  it("gelten für alles im Ordner, auch in Unterordnern", () => {
    expect(inheritsTag("Privat/Figuren/Pikachu/a.jpg", "pikachu", folders)).toBe(true);
    expect(inheritsTag("Privat/Figuren/Pikachu/2024/a.jpg", "Pikachu", folders)).toBe(true);
  });
  it("nicht für Nachbarn mit ähnlichem Namen", () => {
    expect(inheritsTag("Privat/Figuren/Pikachu2/a.jpg", "Pikachu", folders)).toBe(false);
    expect(inheritsTag("Privat/Figuren/a.jpg", "Pikachu", folders)).toBe(false);
    expect(inheritsTag(null, "Pikachu", folders)).toBe(false);
  });
});
