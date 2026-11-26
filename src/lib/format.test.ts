import { describe, expect, it } from "vitest";
import { formatTakenAt } from "./format";

describe("formatTakenAt", () => {
  it("zeigt die Kamera-Uhrzeit unverschoben (auch an der Jahresgrenze)", () => {
    const s = formatTakenAt("2023-12-31T23:30:00Z");
    expect(s).toContain("31.12.");
    expect(s).toContain("23:30");
  });
  it("leer → Unbekannt", () => {
    expect(formatTakenAt(null)).toBe("Unbekannt");
  });
});
