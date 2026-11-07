import { describe, expect, it } from "vitest";
import { countMedia, isVideo, mediaCount, videosLast } from "./media";

describe("media", () => {
  it("erkennt Videos nach Typ und Endung", () => {
    expect(isVideo({ name: "a.jpg", type: "video/quicktime" })).toBe(true);
    expect(isVideo({ name: "IMG_1.MOV" })).toBe(true);
    expect(isVideo({ name: "clip.mp4", mime_type: "image/jpeg" })).toBe(false);
    expect(isVideo({ name: "x.heic" })).toBe(false);
  });
  it("Videos immer zuletzt, sonst Reihenfolge behalten", () => {
    const l = [{ name: "a.mov" }, { name: "b.jpg" }, { name: "0.mp4" }, { name: "c.png" }];
    expect(videosLast(l).map((x) => x.name)).toEqual(["b.jpg", "c.png", "a.mov", "0.mp4"]);
  });
  it("benennt die Menge richtig", () => {
    expect(mediaCount(countMedia([{ name: "a.jpg" }]))).toBe("1 Foto");
    expect(mediaCount(countMedia([{ name: "a.jpg" }, { name: "b.jpg" }]))).toBe("2 Fotos");
    expect(mediaCount(countMedia([{ name: "a.mov" }]))).toBe("1 Video");
    expect(mediaCount(countMedia([{ name: "a.mov" }, { name: "b.jpg" }]))).toBe("2 Dateien");
    expect(mediaCount(countMedia([{ name: "a.mov" }, { name: "b.jpg" }]), "Fotos/Videos")).toBe("2 Fotos/Videos");
  });
});
