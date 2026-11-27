import { describe, expect, it } from "vitest";
import { orphanedUrls, photosOf } from "./offline";
import type { Item } from "./types";

const item = (id: string, mime: string, account = "a"): Item => ({
  account_id: account, drive_id: id, name: id, is_folder: false, mime_type: mime, parent_drive_id: "p",
  size: 1, md5: null, taken_at: null, description: null, path: `X/${id}`, parent_key: "x",
});

describe("photosOf", () => {
  it("nimmt Fotos einmal, zählt Videos nur", () => {
    const r = photosOf([
      { folders: [], files: [item("1", "image/jpeg"), item("v", "video/mp4")] },
      { folders: [], files: [item("1", "image/jpeg"), item("2", "image/png"), item("d", "application/pdf")] },
    ]);
    expect(r.photos.map((p) => p.drive_id)).toEqual(["1", "2"]);
    expect(r.videos).toBe(1);
  });
});

describe("orphanedUrls", () => {
  it("behält Bilder, die ein anderer offline Ordner braucht", () => {
    expect(orphanedUrls(["a", "b", "c", "a"], [["b"], ["x", "c"]])).toEqual(["a"]);
    expect(orphanedUrls(["a"], [])).toEqual(["a"]);
  });
});
