import { describe, expect, it } from "vitest";
import { dupKey, inRandom, lookKey, needsFine, pickOne, qualityFirst, suggestRemoval } from "./duplicates";
import type { Item } from "./types";

const it_ = (id: string, path: string): Item => {
  const parts = path.split("/");
  return {
    account_id: "a",
    drive_id: id,
    name: parts[parts.length - 1],
    is_folder: false,
    mime_type: "image/jpeg",
    parent_drive_id: null,
    size: 1,
    md5: "x",
    taken_at: null,
    description: null,
    path,
    parent_key: parts.slice(0, -1).join("/"),
  };
};
const keys = (s: Set<string>) => [...s].sort();

describe("Duplikate", () => {
  it("im selben Ordner: eine bleibt (kürzester Name), andere Ordner bleiben unberührt", () => {
    const g = [it_("1", "Archiv/Ferien/IMG.jpg"), it_("2", "Archiv/Ferien/IMG (1).jpg"), it_("3", "Archiv/Familie/IMG.jpg")];
    expect(keys(suggestRemoval(g))).toEqual([dupKey(g[1])]);
  });
  it("verschiedene normale Ordner → kein Vorschlag", () => {
    expect(suggestRemoval([it_("1", "Archiv/A/x.jpg"), it_("2", "Archiv/B/x.jpg")]).size).toBe(0);
  });
  it("Random-Kopie weg, wenn das Foto auch woanders liegt – nur direkt in Random", () => {
    const g = [it_("1", "Archiv/A/x.jpg"), it_("2", "Archiv/Random/x.jpg"), it_("3", "Archiv/Random/Sub/x.jpg")];
    expect(keys(suggestRemoval(g))).toEqual([dupKey(g[1])]);
    expect(inRandom(g[1])).toBe(true);
    expect(inRandom(g[2])).toBe(false);
    expect(inRandom(it_("4", "Archiv/Randomly/x.jpg"))).toBe(false);
  });
  it("Unterordner von Random zählen wie normale Ordner", () => {
    const g = [it_("1", "Archiv/A/x.jpg"), it_("2", "Archiv/Random/Favorites /x.jpg")];
    expect(suggestRemoval(g).size).toBe(0);
  });
  it("nur in Random: gilt die Ordner-Regel", () => {
    const g = [it_("1", "Random/x.jpg"), it_("2", "Random/x (1).jpg")];
    expect(keys(suggestRemoval(g))).toEqual([dupKey(g[1])]);
  });
  it("nur 1 entfernen: zuerst Random, sonst die doppelte im selben Ordner", () => {
    expect(pickOne([it_("1", "A/x.jpg"), it_("2", "B/x.jpg"), it_("3", "Random/x.jpg")])).toBe("a|3");
    expect(pickOne([it_("1", "A/x.jpg"), it_("2", "A/x (1).jpg"), it_("3", "B/x.jpg")])).toBe("a|2");
  });
  it("sieht gleich aus: ohne Bildmasse bleibt im selben Ordner die grösste Datei", () => {
    const g = [{ ...it_("1", "A/klein.jpg"), size: 100 }, { ...it_("2", "A/gross-kopie.jpg"), size: 900 }, { ...it_("3", "B/x.jpg"), size: 50 }];
    expect(keys(suggestRemoval(g, qualityFirst))).toEqual([dupKey(g[0])]);
    expect(pickOne(g, qualityFirst)).toBe("a|1");
  });
  it("sieht gleich aus: höhere Auflösung schlägt grössere Datei", () => {
    const png = { ...it_("1", "A/x.png"), mime_type: "image/png", size: 5_000_000, width: 1000, height: 750 };
    const jpg = { ...it_("2", "A/x.jpg"), size: 900_000, width: 4000, height: 3000 };
    expect([png, jpg].sort(qualityFirst)[0]).toBe(jpg);
  });
  it("sieht gleich aus: gleiche Auflösung → Originalformat, dann Aufnahmedatum", () => {
    const png = { ...it_("1", "A/x.png"), mime_type: "image/png", size: 5_000_000, width: 4000, height: 3000 };
    const jpg = { ...it_("2", "A/x.jpg"), size: 900_000, width: 3000, height: 4000 }; // gedreht: gleich viele Pixel
    const heic = { ...it_("3", "A/x.heic"), mime_type: "image/heic", size: 800_000, width: 4000, height: 3000 };
    expect([png, jpg, heic].sort(qualityFirst).map((i) => i.drive_id)).toEqual(["3", "2", "1"]);
    const plain = { ...it_("4", "A/a.jpg"), width: 4000, height: 3000, size: 2 };
    const dated = { ...it_("5", "A/b.jpg"), width: 4000, height: 3000, size: 1, taken_at: "2024-05-01T10:00:00Z" };
    expect([plain, dated].sort(qualityFirst)[0]).toBe(dated);
  });
  it("Screenshots: das PNG ist das Original", () => {
    const png = { ...it_("1", "A/IMG_1.PNG"), mime_type: "image/png", width: 1170, height: 2532, size: 2_000_000 };
    const jpg = { ...it_("2", "A/IMG_1.JPG"), width: 1170, height: 2532, size: 400_000 };
    expect([jpg, png].sort(qualityFirst)[0]).toBe(png);
  });
  it("Feinprüfung für Screenshots und PNG-Grafiken, nicht für Kamerafotos", () => {
    expect(needsFine({ ...it_("1", "A/IMG_1.JPG"), width: 1170, height: 2532 })).toBe(true);
    expect(needsFine({ ...it_("2", "A/logo.png"), mime_type: "image/png" })).toBe(true);
    expect(needsFine({ ...it_("3", "A/IMG_2.JPG"), width: 4032, height: 3024 })).toBe(false);
  });
  it("Schlüssel einer „Sieht gleich aus“-Gruppe hängt nicht von der Reihenfolge ab", () => {
    expect(lookKey(["b", "a", "b"])).toBe("look:a+b");
    expect(lookKey(["a", "b"])).toBe(lookKey(["b", "a"]));
  });
});
