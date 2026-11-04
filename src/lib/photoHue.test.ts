import { describe, expect, it } from "vitest";
import { dominantHue, hueHistogram, needsUpdate, rgbToHsv } from "./photoHue";

/** Bild aus n Bildpunkten einer Farbe (RGBA). */
const img = (...parts: [number, number, number, number][]) => {
  const px: number[] = [];
  for (const [r, g, b, n] of parts) for (let i = 0; i < n; i++) px.push(r, g, b, 255);
  return hueHistogram(px);
};

describe("Ordnerfarbe aus Fotos", () => {
  it("Farbton", () => {
    expect(rgbToHsv(255, 0, 0).h).toBe(0);
    expect(Math.round(rgbToHsv(0, 0, 255).h)).toBe(240);
    expect(rgbToHsv(128, 128, 128).s).toBe(0);
  });
  it("viel Blau → blau, auch mit grauem Rest", () => {
    const h = dominantHue([img([30, 80, 220, 60], [120, 120, 120, 40]), img([40, 100, 230, 50], [250, 250, 250, 50])]);
    expect(h).not.toBeNull();
    expect(h!).toBeGreaterThan(210);
    expect(h!).toBeLessThan(235);
  });
  it("jedes Foto zählt gleich: ein buntes rotes gegen drei blaue", () => {
    const blue = () => img([30, 80, 220, 30], [100, 100, 100, 70]);
    const h = dominantHue([img([255, 0, 0, 100]), blue(), blue(), blue()]);
    expect(h!).toBeGreaterThan(200);
  });
  it("fast ohne Farbe → null", () => {
    expect(dominantHue([img([120, 120, 120, 90], [200, 50, 50, 2])])).toBeNull();
    expect(dominantHue([])).toBeNull();
  });
  it("Rot über die 0°-Grenze bleibt rot", () => {
    const h = dominantHue([img([255, 0, 30, 50], [255, 30, 0, 50])])!;
    expect(h < 15 || h > 345).toBe(true);
  });
  it("neu berechnen nur bei Bedarf", () => {
    const now = Date.now();
    expect(needsUpdate(undefined, 10, now)).toBe(true);
    expect(needsUpdate({ photos: 100, at: now }, 110, now)).toBe(false);
    expect(needsUpdate({ photos: 100, at: now }, 130, now)).toBe(true);
    expect(needsUpdate({ photos: 100, at: now - 61 * 864e5 }, 100, now)).toBe(true);
  });
});
