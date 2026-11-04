import { describe, expect, it } from "vitest";
import { planBatchRename } from "./renameplan";

const e = (...names: string[]) => names.map((name, i) => ({ id: String(i), name }));

describe("planBatchRename", () => {
  it("nummeriert mehrere Fotos und behält die Endung", () => {
    const p = planBatchRename({ entries: e("a.jpg", "b.PNG", "c.heic"), base: "Pink", taken: [] });
    expect(p.map((s) => s.to)).toEqual(["Pink 1.jpg", "Pink 2.PNG", "Pink 3.heic"]);
  });

  it("überspringt Namen, die es im Ordner schon gibt", () => {
    const p = planBatchRename({ entries: e("a.jpg", "b.jpg"), base: "Pink", taken: ["pink 1.jpg", "Pink 3.jpg"] });
    expect(p.map((s) => s.to)).toEqual(["Pink 2.jpg", "Pink 4.jpg"]);
  });

  it("beginnt bei der gewünschten Nummer", () => {
    const p = planBatchRename({ entries: e("a.jpg", "b.jpg"), base: "X", start: 10, taken: [] });
    expect(p.map((s) => s.to)).toEqual(["X 10.jpg", "X 11.jpg"]);
  });

  it("ein einzelnes Foto bekommt genau den Namen, Endung nicht doppelt", () => {
    expect(planBatchRename({ entries: e("a.jpg"), base: "Kris", taken: [] })[0].to).toBe("Kris.jpg");
    expect(planBatchRename({ entries: e("a.jpg"), base: "Kris.jpg", taken: [] })[0].to).toBe("Kris.jpg");
  });

  it("meldet einen Konflikt beim einzelnen Eintrag", () => {
    const [s] = planBatchRename({ entries: e("a.jpg"), base: "Kris", taken: ["kris.jpg"] });
    expect(s.conflict).toBe(true);
  });

  it("Ordner ohne Endung", () => {
    const p = planBatchRename({ entries: e("Alt.v2", "Neu"), base: "Tem", taken: [], folders: true });
    expect(p.map((s) => s.to)).toEqual(["Tem 1", "Tem 2"]);
  });

  it("leerer Name → nichts", () => {
    expect(planBatchRename({ entries: e("a.jpg"), base: "  ", taken: [] })).toEqual([]);
  });
});
