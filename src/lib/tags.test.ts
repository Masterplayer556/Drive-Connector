import { describe, expect, it } from "vitest";
import { cleanTag, countTags, markerColor } from "./tags";

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
