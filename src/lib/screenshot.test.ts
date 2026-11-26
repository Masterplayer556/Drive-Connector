import { describe, expect, it } from "vitest";
import { isScreenshot, screenshotFilter } from "./screenshot";

const png = (width: number | null, height: number | null, name = "IMG_1234.PNG") => ({ name, mime_type: "image/png", width, height });

describe("isScreenshot", () => {
  it("erkennt iPhone-Screenshots ohne passenden Namen an den Massen", () => {
    expect(isScreenshot(png(1170, 2532))).toBe(true);
    expect(isScreenshot(png(2532, 1170))).toBe(true); // quer
    expect(isScreenshot(png(1920, 1080))).toBe(true); // Computer
  });
  it("erkennt unbekannte Handys am hohen Format", () => {
    expect(isScreenshot(png(1080, 2350))).toBe(true);
  });
  it("Kamerafotos und Grafiken sind keine Screenshots", () => {
    expect(isScreenshot({ name: "IMG_1.JPG", mime_type: "image/jpeg", width: 4032, height: 3024 })).toBe(false);
    expect(isScreenshot(png(800, 600))).toBe(false);
    expect(isScreenshot({ name: "wallpaper.jpg", mime_type: "image/jpeg", width: 1920, height: 1080 })).toBe(false);
  });
  it("JPEG mit exakter Handy-Auflösung zählt", () => {
    expect(isScreenshot({ name: "IMG_9.JPG", mime_type: "image/jpeg", width: 1179, height: 2556 })).toBe(true);
  });
  it("Name oder Ordner reicht wie bisher, ohne Masse", () => {
    expect(isScreenshot(png(null, null, "Screenshot 2024-01-01.png"))).toBe(true);
    expect(isScreenshot({ name: "a.png", mime_type: "image/png", path: "Privat/Screenshots/a.png" })).toBe(true);
    expect(isScreenshot(png(null, null))).toBe(false);
  });
  it("Videos nie", () => {
    expect(isScreenshot({ name: "screenshot.mp4", mime_type: "video/mp4", width: 1170, height: 2532 })).toBe(false);
  });
});

describe("screenshotFilter", () => {
  it("enthält beide Ausrichtungen", () => {
    const f = screenshotFilter();
    expect(f).toContain("and(width.eq.1170,height.eq.2532)");
    expect(f).toContain("and(width.eq.2532,height.eq.1170)");
  });
});
