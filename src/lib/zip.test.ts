import { describe, expect, it } from "vitest";
import { buildZip, chunkBySize, crc32 } from "./zip";

describe("crc32", () => {
  it("stimmt mit dem Referenzwert überein", () => {
    expect(crc32(new TextEncoder().encode("123456789")).toString(16)).toBe("cbf43926");
  });
});

describe("buildZip", () => {
  it("erzeugt gültige Signaturen und Einträge", async () => {
    const blob = buildZip([
      { name: "Ordner/1.jpg", data: new Uint8Array([1, 2, 3]) },
      { name: "Ordner/ä.png", data: new Uint8Array([4]) },
    ]);
    const v = new DataView(await blob.arrayBuffer());
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const endAt = v.byteLength - 22;
    expect(v.getUint32(endAt, true)).toBe(0x06054b50);
    expect(v.getUint16(endAt + 10, true)).toBe(2);
    const cdOffset = v.getUint32(endAt + 16, true);
    expect(v.getUint32(cdOffset, true)).toBe(0x02014b50);
  });
});

describe("chunkBySize", () => {
  it("teilt nach Grösse und Anzahl", () => {
    expect(chunkBySize([5, 5, 5, 5], (x) => x, 10)).toEqual([[5, 5], [5, 5]]);
    expect(chunkBySize([1, 1, 1], (x) => x, 100, 2)).toEqual([[1, 1], [1]]);
    expect(chunkBySize([50], (x) => x, 10)).toEqual([[50]]);
  });
});
