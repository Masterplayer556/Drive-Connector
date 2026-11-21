import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Item } from "./types";

// Netz nachbilden: jedes Bild kommt erst, wenn der Test es freigibt
const calls: string[][] = [];
const release = new Map<string, () => void>();
vi.mock("./thumbSource", () => ({
  fetchThumbBlobs: async (
    _acc: string,
    _folder: string | null,
    ids: string[],
    _size: number,
    { onBlob }: { onBlob?: (id: string, b: Blob) => void } = {},
  ) => {
    calls.push(ids);
    const out = new Map<string, Blob>();
    await Promise.all(
      ids.map(
        (id) =>
          new Promise<void>((r) =>
            release.set(id, () => {
              const b = new Blob([id], { type: "image/jpeg" });
              out.set(id, b);
              onBlob?.(id, b);
              r();
            }),
          ),
      ),
    );
    return out;
  },
}));

const item = (id: string): Item => ({ account_id: "k", drive_id: id, parent_drive_id: "ordner", name: `${id}.jpg` }) as Item;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

let thumbs: typeof import("./thumbs");
beforeAll(async () => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { baseURI: "https://app.test/" });
  let n = 0;
  vi.stubGlobal("URL", Object.assign(globalThis.URL, { createObjectURL: () => `blob:${++n}` }));
  thumbs = await import("./thumbs");
});

describe("getThumb", () => {
  it("liefert ein Bild, sobald es da ist – ohne auf den Rest des Pakets zu warten", async () => {
    const got: string[] = [];
    for (const id of ["a1", "a2", "a3"]) void thumbs.getThumb(item(id), 1600).then(() => got.push(id));
    await tick(50);
    expect(calls.at(-1)).toEqual(["a1", "a2", "a3"]);
    release.get("a2")!();
    await tick();
    expect(got).toEqual(["a2"]);
    release.get("a1")!();
    release.get("a3")!();
    await tick();
    expect(got).toEqual(["a2", "a1", "a3"]);
  });

  it("dringende Bilder kommen vor die vorgeladenen", async () => {
    for (const id of ["b1", "b2", "b3"]) void thumbs.getThumb(item(id), 1600).catch(() => undefined);
    void thumbs.getThumb(item("jetzt"), 1600, { urgent: true });
    await tick(50);
    expect(calls.at(-1)?.[0]).toBe("jetzt");
    for (const id of ["jetzt", "b1", "b2", "b3"]) release.get(id)!();
  });

  it("ein schon vorgeladenes Bild rückt nach vorne, wenn es angezeigt wird", async () => {
    for (const id of ["c1", "c2", "c3"]) void thumbs.getThumb(item(id), 1600).catch(() => undefined);
    await tick(); // Cache-Abfrage vorbei, Bilder warten in der Schlange
    void thumbs.getThumb(item("c3"), 1600, { urgent: true });
    await tick(50);
    expect(calls.at(-1)?.[0]).toBe("c3");
    for (const id of ["c1", "c2", "c3"]) release.get(id)!();
  });
});
