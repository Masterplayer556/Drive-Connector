import { describe, expect, it } from "vitest";
import { FINE } from "./lookalike";
import { applyFine, fineKey, fineTodo, pairKey } from "./lookVerify";
import type { Item } from "./types";

const item = (id: string, md5: string, extra: Partial<Item> = {}): Item => ({
  account_id: "a",
  drive_id: id,
  name: `${id}.png`,
  is_folder: false,
  mime_type: "image/png",
  parent_drive_id: null,
  size: 1,
  md5,
  taken_at: null,
  description: null,
  path: `A/${id}.png`,
  parent_key: "a",
  ...extra,
});
const grid = (v: number) => new Uint8Array(FINE * FINE).fill(v);

describe("Feinprüfung von Gruppen", () => {
  it("Kamerafotos brauchen keine Feinprüfung", () => {
    const g = [item("1", "m1", { mime_type: "image/jpeg", name: "1.jpg" }), item("2", "m2", { mime_type: "image/jpeg", name: "2.jpg" })];
    expect(fineTodo([g], new Map())).toEqual([]);
    expect(applyFine([g], new Map(), new Map())).toEqual([{ items: g, unsure: false }]);
  });
  it("Screenshots: verschiedene raus, gleiche bleiben, Urteile werden gemerkt", () => {
    const g = [item("1", "m1", { width: 1000, height: 1000 }), item("2", "m2", { width: 500, height: 500 }), item("3", "m3", { width: 500, height: 500 })];
    expect(fineTodo([g], new Map()).map((i) => i.drive_id).sort()).toEqual(["1", "2", "3"]);
    const fine = new Map([
      [fineKey(g[0]), grid(100)],
      [fineKey(g[1]), grid(102)],
      [fineKey(g[2]), grid(160)],
    ]);
    const cache = new Map<string, boolean>();
    const [res] = applyFine([g], fine, cache);
    expect(res).toEqual({ items: [g[0], g[1]], unsure: false });
    expect(cache.get(pairKey("m1", "m2"))).toBe(true);
    expect(cache.get(pairKey("m3", "m1"))).toBe(false);
    // Beim nächsten Mal ohne Laden
    expect(fineTodo([g], cache)).toEqual([]);
    expect(applyFine([g], new Map(), cache)).toEqual([res]);
  });
  it("alle verschieden → keine Gruppe mehr", () => {
    const g = [item("1", "m1"), item("2", "m2")];
    const fine = new Map([
      [fineKey(g[0]), grid(0)],
      [fineKey(g[1]), grid(200)],
    ]);
    expect(applyFine([g], fine, new Map())).toEqual([null]);
  });
  it("Vorschau fehlt → bleibt, aber „nicht sicher“", () => {
    const g = [item("1", "m1"), item("2", "m2")];
    expect(applyFine([g], new Map([[fineKey(g[0]), grid(0)]]), new Map())).toEqual([{ items: g, unsure: true }]);
  });
});
