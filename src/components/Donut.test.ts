import { describe, expect, it } from "vitest";
import { levelClass, orbitPieces } from "./Donut";

describe("levelClass", () => {
  it("färbt die Prozentzahl nach Füllstand", () => {
    expect(levelClass(58)).toBeUndefined();
    expect(levelClass(69)).toBe("gold");
    expect(levelClass(69, 40)).toBeUndefined(); // erst golden, wenn die Zahl angekommen ist
    expect(levelClass(79)).toBeUndefined();
    expect(levelClass(80)).toBe("lvl-warn");
    expect(levelClass(89)).toBe("lvl-warn");
    expect(levelClass(90)).toBe("lvl-red");
    expect(levelClass(94)).toBe("lvl-red");
    expect(levelClass(95)).toBe("lvl-crit");
    expect(levelClass(100)).toBe("lvl-crit");
  });
});

describe("orbitPieces (Kosmos)", () => {
  it("teilt einen Bogen an der Grenze vorne/hinten und beginnt genau bei 0°", () => {
    const p = orbitPieces([{ from: 0, to: 0.7, color: "a" }]);
    expect(p.map((x) => [x.from, x.to, x.back])).toEqual([
      [0, 0.5, false], // untere Hälfte: vor dem Planeten
      [0.5, 0.7, true], // obere Hälfte: dahinter
    ]);
    expect(p[0].d.startsWith("M 117.00 60.00")).toBe(true); // rechter Rand der Bahn
  });

  it("lässt zwischen Konten eine kleine Lücke und endet dort, wo der Mond sitzt", () => {
    const p = orbitPieces([
      { from: 0, to: 0.2, color: "a" },
      { from: 0.2, to: 0.45, color: "b" },
    ]);
    expect(p).toHaveLength(2);
    expect(p[0].to).toBeCloseTo(0.194, 3);
    expect(p.every((x) => !x.back)).toBe(true);
  });
});
