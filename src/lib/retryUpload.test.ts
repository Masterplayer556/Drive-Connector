import { describe, expect, it } from "vitest";
import type { PlanEntry } from "./plan";
import { groupByTarget, planRetry, type FailedUpload } from "./retryUpload";

const entry = (id: string, targetName: string, md5: string): PlanEntry => ({
  id,
  originalName: targetName,
  targetName,
  size: 10,
  md5,
  status: "upload",
  renamed: null,
  number: null,
});

describe("planRetry", () => {
  it("lädt fehlende nochmals hoch", () => {
    const r = planRetry([entry("a", "IMG_1.JPG", "m1")], [{ name: "anderes.jpg", md5: "x" }]);
    expect(r.retry.map((e) => e.id)).toEqual(["a"]);
    expect(r.present).toEqual([]);
    expect(r.blocked).toEqual([]);
  });

  it("erkennt eine trotz Fehler angekommene Datei (gleicher Name, gleiche Prüfsumme)", () => {
    const r = planRetry([entry("a", "IMG_1.JPG", "m1")], [{ name: "img_1.jpg", md5: "m1" }]);
    expect(r.present.map((e) => e.id)).toEqual(["a"]);
    expect(r.retry).toEqual([]);
  });

  it("überschreibt keinen inzwischen belegten Namen", () => {
    const r = planRetry([entry("a", "001.jpg", "m1")], [{ name: "001.jpg", md5: "andere" }]);
    expect(r.blocked).toHaveLength(1);
    expect(r.retry).toEqual([]);
  });
});

describe("groupByTarget", () => {
  it("trennt Stapel mit eigener Datei-Liste, auch beim gleichen Ordner", () => {
    const t = { name: "A", path: "A", key: "a" };
    const f1 = new Map<string, File>();
    const f2 = new Map<string, File>();
    const items: FailedUpload[] = [
      { entry: entry("f0", "1.jpg", "1"), error: "x", target: t, files: f1 },
      { entry: entry("f1", "2.jpg", "2"), error: "x", target: t, files: f1 },
      { entry: entry("f0", "3.jpg", "3"), error: "x", target: t, files: f2 },
    ];
    const g = groupByTarget(items);
    expect(g).toHaveLength(2);
    expect(g[0].entries.map((e) => e.targetName)).toEqual(["1.jpg", "2.jpg"]);
  });
});
