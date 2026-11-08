import { describe, expect, it } from "vitest";
import { arcPath, colorAt, toRanges, wedgePath } from "./donutGeometry";

describe("toRanges", () => {
  it("reiht die Konten aneinander", () => {
    const r = toRanges([{ value: 20, color: "a" }, { value: 0, color: "b" }, { value: 30, color: "c" }], 100);
    expect(r).toEqual([
      { from: 0, to: 0.2, color: "a" },
      { from: 0.2, to: 0.5, color: "c" },
    ]);
  });

  it("geht nie über 100 % hinaus und kommt mit 0 Speicher klar", () => {
    const r = toRanges([{ value: 80, color: "a" }, { value: 80, color: "b" }], 100);
    expect(r.at(-1)?.to).toBe(1);
    expect(toRanges([{ value: 5, color: "a" }], 0)).toEqual([]);
  });
});

describe("colorAt", () => {
  it("findet das Konto an einer Stelle, sonst frei", () => {
    const r = toRanges([{ value: 20, color: "a" }, { value: 30, color: "c" }], 100);
    expect(colorAt(r, 0.1)).toBe("a");
    expect(colorAt(r, 0.3)).toBe("c");
    expect(colorAt(r, 0.7)).toBeNull();
  });
});

describe("arcPath / wedgePath", () => {
  it("zeichnet Halbkreis und Vollkreis ohne zu entarten", () => {
    expect(arcPath(0, 0, 10, Math.PI, Math.PI * 2)).toBe("M -10 0 A 10 10 0 0 1 10 0");
    const full = arcPath(0, 0, 10, 0, Math.PI * 2);
    expect(full).toContain(" 0 1 1 ");
    expect(full).not.toContain("NaN");
    expect(wedgePath(0, 0, 10, 0, Math.PI / 2)).toBe("M 0 0 L 10 0 A 10 10 0 0 1 0 10 Z");
  });
});
