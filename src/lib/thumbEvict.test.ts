import { describe, expect, it } from "vitest";
import { pickEvictions } from "./thumbEvict";

const url = (id: number, size: number) => `https://app.test/__thumbs/konto/datei${id}/${size}`;

describe("pickEvictions", () => {
  it("lässt alles stehen, solange die Obergrenzen nicht erreicht sind", () => {
    const urls = [url(1, 320), url(2, 320), url(1, 1600)];
    expect(pickEvictions(urls, { small: 2, large: 1 })).toEqual([]);
  });

  it("entfernt die ältesten zuerst – je Grössenklasse getrennt", () => {
    const urls = [url(1, 320), url(1, 1600), url(2, 320), url(2, 1600), url(3, 320), url(3, 1600)];
    expect(pickEvictions(urls, { small: 2, large: 1 })).toEqual([url(1, 320), url(1, 1600), url(2, 1600)]);
  });

  it("grosse Ansichten verdrängen keine Raster-Bilder", () => {
    const urls = [url(1, 320), ...Array.from({ length: 5 }, (_, i) => url(i + 10, 1600))];
    const gone = pickEvictions(urls, { small: 1, large: 2 });
    expect(gone).toHaveLength(3);
    expect(gone).not.toContain(url(1, 320));
  });

  it("zählt Adressen ohne erkennbare Grösse zu den kleinen", () => {
    expect(pickEvictions(["https://app.test/__thumbs/kaputt", url(1, 320)], { small: 1, large: 0 })).toEqual(["https://app.test/__thumbs/kaputt"]);
  });
});
