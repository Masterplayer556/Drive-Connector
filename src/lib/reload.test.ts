import { describe, expect, it } from "vitest";
import { isChunkError, mayReload } from "./reload";

describe("isChunkError", () => {
  it("erkennt fehlgeschlagenes Nachladen in Safari, Chrome und Firefox", () => {
    expect(isChunkError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkError(new TypeError("Failed to fetch dynamically imported module: https://x/assets/RegalView-abc.js"))).toBe(true);
    expect(isChunkError(new TypeError("error loading dynamically imported module"))).toBe(true);
    expect(isChunkError(new Error("Unable to preload CSS for /assets/x.css"))).toBe(true);
  });

  it("hält andere Fehler nicht dafür", () => {
    expect(isChunkError(new Error("Cannot read properties of undefined (reading 'name')"))).toBe(false);
    expect(isChunkError(new TypeError("Load failed"))).toBe(false);
    expect(isChunkError("irgendwas")).toBe(false);
    expect(isChunkError(null)).toBe(false);
  });
});

describe("mayReload", () => {
  it("lädt beim ersten Mal und nach einer Minute wieder", () => {
    expect(mayReload(0, 1_000_000)).toBe(true);
    expect(mayReload(1_000_000, 1_061_000)).toBe(true);
  });

  it("lädt nicht zweimal kurz hintereinander", () => {
    expect(mayReload(1_000_000, 1_005_000)).toBe(false);
  });
});
