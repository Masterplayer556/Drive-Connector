import { describe, expect, it } from "vitest";
import { dupKey, inRandom, pickOne, suggestRemoval } from "./duplicates";
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
});
