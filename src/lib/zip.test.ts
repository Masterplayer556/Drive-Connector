import { describe, expect, it } from "vitest";
import { buildZip, chunkBySize, crc32, dosTime, zipNames, zipTooBig } from "./zip";

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

describe("dosTime", () => {
  it("nimmt bei Aufnahmezeiten die UTC-Felder (Kamera-Uhrzeit)", () => {
    const d = new Date("2023-12-31T23:30:10Z");
    const { time, date } = dosTime(d, true);
    expect(date >> 9).toBe(2023 - 1980);
    expect((date >> 5) & 0xf).toBe(12);
    expect(date & 0x1f).toBe(31);
    expect(time >> 11).toBe(23);
    expect((time >> 5) & 0x3f).toBe(30);
  });
});

describe("zipNames", () => {
  it("Pfad relativ zum Ordner, Gross-/Kleinschreibung egal", () => {
    expect(zipNames([{ name: "1.jpg", path: "Ferien/2023/1.jpg" }, { name: "2.jpg", path: "ferien/2.jpg" }], "Ferien")).toEqual([
      "2023/1.jpg",
      "2.jpg",
    ]);
  });
  it("gleiche Namen werden nummeriert statt überschrieben", () => {
    expect(
      zipNames([
        { name: "a.jpg", path: "X/a.jpg" },
        { name: "a.jpg", path: "Y/a.jpg" },
        { name: "A.JPG", path: "Z/A.JPG" },
        { name: "a (2).jpg", path: "W/a (2).jpg" },
        { name: "ohne", path: "V/ohne" },
        { name: "ohne", path: "U/ohne" },
      ]),
    ).toEqual(["X/a.jpg", "Y/a.jpg", "Z/A.JPG", "W/a (2).jpg", "V/ohne", "U/ohne"]);
    expect(
      zipNames(
        [
          { name: "a.jpg", path: "X/a.jpg" },
          { name: "a.jpg", path: "Y/a.jpg" },
          { name: "A.JPG", path: "Z/A.JPG" },
          { name: "a (2).jpg", path: "W/a (2).jpg" },
        ],
        "Q",
      ),
    ).toEqual(["a.jpg", "a (2).jpg", "A (3).JPG", "a (2) (2).jpg"]);
  });
});

describe("ZIP-Grenze 4 GB", () => {
  it("meldet zu grosse Dateien vor dem Herunterladen", () => {
    expect(zipTooBig([{ name: "a.jpg", size: 10 }])).toBeNull();
    expect(zipTooBig([{ name: "film.mp4", size: 5 * 1024 ** 3 }])).toContain("film.mp4");
  });
});
