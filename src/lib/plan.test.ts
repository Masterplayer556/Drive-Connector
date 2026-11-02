import { describe, expect, it } from "vitest";
import { planUpload, summarize, type PlanInput } from "./plan";

const now = new Date(2026, 10, 2, 14, 32, 5);
const base: PlanInput = {
  files: [],
  orderMode: false,
  order: [],
  startNumber: 1,
  existingNames: [],
  knownMd5: new Set(),
  folderBytes: 0,
  folderHasSubfolders: false,
  conflictMode: "skip",
  now,
};
const f = (id: string, name: string, size = 1000, md5 = id) => ({ id, name, size, md5 });

describe("planUpload", () => {
  it("lässt normale Namen unverändert", () => {
    const r = planUpload({ ...base, files: [f("a", "IMG_1.jpg")] });
    expect(r[0]).toMatchObject({ status: "upload", targetName: "IMG_1.jpg", renamed: null });
  });

  it("überspringt Duplikate aus dem Pool und innerhalb der Auswahl", () => {
    const r = planUpload({
      ...base,
      knownMd5: new Set(["x"]),
      files: [f("a", "A.jpg", 1, "x"), f("b", "B.jpg", 1, "y"), f("c", "C.jpg", 1, "y")],
    });
    expect(r.map((e) => e.status)).toEqual(["duplicate", "upload", "duplicate"]);
  });

  it("Zahlen-Schutz benennt reine Zahlennamen um (Regel 14)", () => {
    const r = planUpload({ ...base, files: [f("a", "0001.png"), f("b", "5.jpg")] });
    expect(r[0]).toMatchObject({ targetName: "Foto_2026-11-02_14-32-05.png", renamed: "zahlenschutz" });
    expect(r[1]).toMatchObject({ targetName: "Foto_2026-11-02_14-32-05.jpg", renamed: "zahlenschutz" });
  });

  it("Zahlen-Schutz vergibt bei gleicher Endung eindeutige Namen", () => {
    const r = planUpload({ ...base, files: [f("a", "1.png"), f("b", "2.png")] });
    expect(r.map((e) => e.targetName)).toEqual(["Foto_2026-11-02_14-32-05.png", "Foto_2026-11-02_14-32-05_2.png"]);
  });

  it("Namenskonflikt: überspringen oder umbenennen (Regel 2)", () => {
    const input = { ...base, existingNames: ["IMG_1.JPG"], files: [f("a", "IMG_1.jpg")] };
    expect(planUpload(input)[0].status).toBe("conflict");
    expect(planUpload({ ...input, conflictMode: "rename" })[0]).toMatchObject({
      status: "upload",
      renamed: "konflikt",
      targetName: "Foto_2026-11-02_14-32-05.jpg",
    });
  });

  it("Reihenfolge-Upload zählt ab startNumber in der angetippten Reihenfolge (Regel 11)", () => {
    const r = planUpload({
      ...base,
      orderMode: true,
      order: ["c", "a"],
      startNumber: 81,
      files: [f("a", "IMG_1.jpg"), f("b", "IMG_2.png"), f("c", "0007.png")],
    });
    expect(r.map((e) => [e.id, e.targetName])).toEqual([
      ["c", "81.png"],
      ["a", "82.jpg"],
      ["b", "83.png"],
    ]);
  });

  it("Duplikate verbrauchen keine Nummer", () => {
    const r = planUpload({
      ...base,
      orderMode: true,
      startNumber: 1,
      knownMd5: new Set(["dup"]),
      files: [f("a", "a.png", 1, "dup"), f("b", "b.png")],
    });
    expect(r[1].targetName).toBe("1.png");
  });

  it("blockiert Uploads ab 15 GB in Ordnern ohne Unterordner (Regel 4)", () => {
    const r = planUpload({
      ...base,
      limitBytes: 100,
      folderBytes: 80,
      files: [f("a", "a.jpg", 10), f("b", "b.jpg", 10), f("c", "c.jpg", 5)],
    });
    expect(r.map((e) => e.status)).toEqual(["upload", "limit", "upload"]);
  });

  it("ignoriert die Grenze bei Ordnern mit Unterordnern", () => {
    const r = planUpload({ ...base, limitBytes: 100, folderBytes: 200, folderHasSubfolders: true, files: [f("a", "a.jpg")] });
    expect(r[0].status).toBe("upload");
  });

  it("fasst zusammen", () => {
    const r = planUpload({ ...base, knownMd5: new Set(["d"]), files: [f("a", "1.png"), f("b", "x.png", 1, "d")] });
    expect(summarize(r)).toMatchObject({ upload: 1, duplicate: 1, renamed: 1 });
  });
});
