import { describe, expect, it } from "vitest";
import { levelClass } from "./Donut";

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
