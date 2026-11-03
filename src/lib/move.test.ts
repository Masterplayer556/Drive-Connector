import { describe, expect, it } from "vitest";
import { planMove } from "./move";
import type { Item } from "./types";

const it_ = (name: string, parent_key = "archiv/a", size = 10): Item => ({
  account_id: "a1", drive_id: name, name, is_folder: false, mime_type: null, parent_drive_id: "p",
  size, md5: null, taken_at: null, description: null, path: `${parent_key}/${name}`, parent_key,
});
const base = { targetKey: "archiv/b", existingNames: [] as string[], targetBytes: 0, targetHasSubfolders: false, conflictMode: "skip" as const, now: new Date(2026, 10, 2, 9, 0, 0) };

describe("planMove", () => {
  it("verschiebt normale Fotos und behält den Namen", () => {
    expect(planMove({ ...base, items: [it_("x.jpg")] })[0]).toMatchObject({ status: "move", targetName: "x.jpg" });
  });
  it("lässt Fotos im selben Ordner aus", () => {
    expect(planMove({ ...base, items: [it_("x.jpg", "archiv/b")] })[0].status).toBe("same");
  });
  it("Namenskonflikt: überspringen oder umbenennen (Regel 2)", () => {
    expect(planMove({ ...base, existingNames: ["X.JPG"], items: [it_("x.jpg")] })[0].status).toBe("conflict");
    expect(planMove({ ...base, conflictMode: "rename", existingNames: ["x.jpg"], items: [it_("x.jpg")] })[0]).toMatchObject({
      status: "move", renamed: true, targetName: "Foto_2026-11-02_09-00-00.jpg",
    });
  });
  it("zwei gleiche Namen aus verschiedenen Ordnern kollidieren auch untereinander", () => {
    const r = planMove({ ...base, items: [it_("1.png", "archiv/a"), it_("1.png", "archiv/c")] });
    expect(r.map((e) => e.status)).toEqual(["move", "conflict"]);
  });
  it("blockiert ab 15 GB in Ordnern ohne Unterordner (Regel 4)", () => {
    const r = planMove({ ...base, limitBytes: 25, targetBytes: 10, items: [it_("a.jpg"), it_("b.jpg")] });
    expect(r.map((e) => e.status)).toEqual(["move", "limit"]);
  });
});
