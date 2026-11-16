import { describe, expect, it } from "vitest";
import { dayKey, isLight, rollIfNewDay, rollThemes, THEMES, type ThemePrefs } from "./theme";

const base: ThemePrefs = { theme: "aurora", auto: false, light: "polar", dark: "aurora", daily: true, day: "2026-11-15" };
/** Feste „Zufalls“-Folge für die Tests */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe("Design würfeln", () => {
  it("ohne Automatik: irgendein anderes Design", () => {
    for (const r of [0, 0.3, 0.6, 0.999]) {
      const next = rollThemes(base, () => r);
      expect(next.theme).not.toBe("aurora");
      expect(THEMES.some((t) => t.id === next.theme)).toBe(true);
      expect([next.light, next.dark]).toEqual(["polar", "aurora"]);
    }
  });
  it("mit Automatik: helles Design für hell, dunkles für dunkel – beide neu", () => {
    for (const r of [0, 0.5, 0.999]) {
      const next = rollThemes({ ...base, auto: true }, seq(r, 1 - r - 0.0005));
      expect(isLight(next.light)).toBe(true);
      expect(isLight(next.dark)).toBe(false);
      expect(next.light).not.toBe("polar");
      expect(next.dark).not.toBe("aurora");
      expect(next.theme).toBe("aurora");
    }
  });
  it("jeden Tag neu: nur an einem neuen Tag und nur wenn eingeschaltet", () => {
    expect(rollIfNewDay(base, "2026-11-15")).toBe(base);
    expect(rollIfNewDay({ ...base, daily: false }, "2026-11-16")).toMatchObject({ theme: "aurora", day: "2026-11-15" });
    const next = rollIfNewDay(base, "2026-11-16", () => 0.4);
    expect(next.day).toBe("2026-11-16");
    expect(next.theme).not.toBe("aurora");
  });
  it("Tag in Ortszeit", () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
