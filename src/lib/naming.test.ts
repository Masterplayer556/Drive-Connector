import { describe, expect, it } from "vitest";
import { childKey, maxNumber, naturalCompare, protectedName, pureNumber, splitExt, validFolderName } from "./naming";

describe("naturalCompare", () => {
  it("sortiert Zahlen natürlich", () => {
    const names = ["10.png", "2.png", "1.png", "0080.png", "81.png", "IMG_1.jpg", "Foto_2026.png"];
    expect([...names].sort(naturalCompare)).toEqual([
      "1.png",
      "2.png",
      "10.png",
      "0080.png",
      "81.png",
      "Foto_2026.png",
      "IMG_1.jpg",
    ]);
  });
});

describe("splitExt / pureNumber", () => {
  it("trennt die Endung", () => {
    expect(splitExt("a.b.png")).toEqual({ base: "a.b", ext: ".png" });
    expect(splitExt("ohne")).toEqual({ base: "ohne", ext: "" });
    expect(splitExt(".png")).toEqual({ base: ".png", ext: "" });
  });
  it("erkennt reine Zahlen", () => {
    expect(pureNumber("0080.png")).toBe(80);
    expect(pureNumber("5")).toBe(5);
    expect(pureNumber("1a.png")).toBeNull();
    expect(pureNumber("IMG_0001.png")).toBeNull();
    expect(pureNumber("1.2.png")).toBeNull();
  });
  it("findet die höchste Zahl", () => {
    expect(maxNumber(["1.png", "0080.png", "IMG_99.png", "3.jpg"])).toBe(80);
    expect(maxNumber(["IMG_1.png"])).toBe(0);
  });
});

describe("protectedName", () => {
  const now = new Date(2026, 10, 2, 14, 32, 5);
  it("baut Foto_Datum-Namen und behält die Endung", () => {
    expect(protectedName("0001.png", now, new Set())).toBe("Foto_2026-11-02_14-32-05.png");
  });
  it("zählt bei Gleichstand hoch", () => {
    const taken = new Set(["foto_2026-11-02_14-32-05.png", "foto_2026-11-02_14-32-05_2.png"]);
    expect(protectedName("7.png", now, taken)).toBe("Foto_2026-11-02_14-32-05_3.png");
  });
});

describe("Ordner", () => {
  it("baut Schlüssel in Kleinbuchstaben", () => {
    expect(childKey("", "Schule")).toBe("schule");
    expect(childKey("schule", "Mathe")).toBe("schule/mathe");
  });
  it("prüft Ordnernamen", () => {
    expect(validFolderName("  ")).not.toBeNull();
    expect(validFolderName("a/b")).not.toBeNull();
    expect(validFolderName("Mathe")).toBeNull();
  });
});
