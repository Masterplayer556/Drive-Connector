import { describe, expect, it } from "vitest";
import { inTestFolders } from "./flag";

describe("Testordner", () => {
  const f = ["HH", "TLOZ", "Super Mario", "Underrune"];
  it("Ordnername irgendwo im Pfad, Gross/klein egal", () => {
    expect(inTestFolders("Privat/Games/TLOZ/link.png", f)).toBe(true);
    expect(inTestFolders("Privat/super mario/2024/a.jpg", f)).toBe(true);
    expect(inTestFolders("Privat/HH/a.jpg", f)).toBe(true);
  });
  it("nur ganze Ordnernamen, nicht der Dateiname", () => {
    expect(inTestFolders("Privat/HHH/a.jpg", f)).toBe(false);
    expect(inTestFolders("Privat/Bilder/TLOZ", f)).toBe(false);
    expect(inTestFolders(null, f)).toBe(false);
  });
});
