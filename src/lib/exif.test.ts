import { describe, expect, it } from "vitest";
import { byCaptureTime, exifDateFromBuffer, mvhdDateFromMoov } from "./exif";

/** Baut ein minimales JPEG mit EXIF (IFD0 → ExifIFD → DateTimeOriginal). */
function jpegWithExif(date: string, littleEndian = true): ArrayBuffer {
  const tiff = tiffWithDate(date, littleEndian);
  const app1Len = 2 + 6 + tiff.length;
  const bytes = [0xff, 0xd8, 0xff, 0xe1, app1Len >> 8, app1Len & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff, 0xff, 0xda];
  return new Uint8Array(bytes).buffer;
}

/** Wie in HEIC: irgendwo im Dateianfang „Exif\0\0“ + TIFF. */
function heicLike(date: string, subsec?: string): ArrayBuffer {
  const junk = [0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 1, 2, 3, 4];
  return new Uint8Array([...junk, 0, 0, 0, 6, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiffWithDate(date, true, subsec)]).buffer;
}

function tiffWithDate(date: string, littleEndian = true, subsec?: string): number[] {
  const tiff: number[] = [];
  const w16 = (n: number) => (littleEndian ? tiff.push(n & 0xff, n >> 8) : tiff.push(n >> 8, n & 0xff));
  const w32 = (n: number) =>
    littleEndian
      ? tiff.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff)
      : tiff.push((n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
  tiff.push(...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]));
  w16(42);
  w32(8); // IFD0 bei 8
  // IFD0: 1 Eintrag (ExifIFD-Zeiger)
  w16(1);
  w16(0x8769); w16(4); w32(1); w32(26); // Exif-IFD bei 26
  w32(0);
  // Exif-IFD bei 26: 1 Eintrag DateTimeOriginal
  // Exif-IFD bei 26: DateTimeOriginal (+ SubSecTimeOriginal)
  const n = subsec ? 2 : 1;
  const text = 26 + 2 + n * 12 + 4;
  w16(n);
  w16(0x9003); w16(2); w32(20); w32(text);
  if (subsec) {
    w16(0x9291); w16(2); w32(subsec.length + 1);
    const b = [...subsec].map((c) => c.charCodeAt(0));
    while (b.length < 4) b.push(0);
    tiff.push(...b);
  }
  w32(0);
  for (const c of date) tiff.push(c.charCodeAt(0));
  tiff.push(0);
  return tiff;
}

describe("exifDateFromBuffer", () => {
  it("liest DateTimeOriginal (Little Endian)", () => {
    const d = exifDateFromBuffer(jpegWithExif("2024:07:15 18:30:05"))!;
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2024, 7, 15, 18, 30]);
  });
  it("liest DateTimeOriginal (Big Endian)", () => {
    const d = exifDateFromBuffer(jpegWithExif("2019:01:02 03:04:05", false))!;
    expect(d.getFullYear()).toBe(2019);
    expect(d.getMonth()).toBe(0);
  });
  it("gibt null zurück, wenn kein JPEG oder kein EXIF", () => {
    expect(exifDateFromBuffer(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBeNull();
    expect(exifDateFromBuffer(new Uint8Array([0xff, 0xd8, 0xff, 0xda]).buffer)).toBeNull();
  });
  it("gibt null zurück bei ungültigem Datum", () => {
    expect(exifDateFromBuffer(jpegWithExif("0000:00:00 00:00:00"))).toBeNull();
  });
});

describe("weitere Formate", () => {
  it("findet EXIF mitten im Dateianfang (HEIC) inkl. Sekundenbruchteilen", () => {
    const d = exifDateFromBuffer(heicLike("2023:05:06 07:08:09", "45"))!;
    expect([d.getFullYear(), d.getMonth() + 1, d.getSeconds(), d.getMilliseconds()]).toEqual([2023, 5, 9, 450]);
  });
  it("liest XMP-Datum (Bildschirmfoto)", () => {
    const xmp = '<x:xmpmeta><rdf:Description photoshop:DateCreated="2025-03-04T10:11:12.250+01:00"/></x:xmpmeta>';
    const d = exifDateFromBuffer(new TextEncoder().encode(xmp).buffer as ArrayBuffer)!;
    expect(d.toISOString()).toBe("2025-03-04T09:11:12.250Z");
  });
  it("liest das Erstelldatum eines Videos aus mvhd", () => {
    const secs = 2082844800 + Date.UTC(2024, 0, 2, 3, 4, 5) / 1000;
    const box = new DataView(new ArrayBuffer(8 + 8 + 12 + 20));
    box.setUint32(0, 16); box.setUint32(4, 0x75647461); // „udta“ davor
    box.setUint32(16, 32); box.setUint32(20, 0x6d766864); // „mvhd“
    box.setUint32(28, secs);
    expect(mvhdDateFromMoov(box.buffer)!.toISOString()).toBe("2024-01-02T03:04:05.000Z");
  });
});

describe("byCaptureTime", () => {
  const t = (x: { t: number | null }) => x.t;
  it("sortiert nach Aufnahmezeit, gleiche Zeit behält die Reihenfolge", () => {
    const l = [{ n: "c", t: 3 }, { n: "a", t: 1 }, { n: "b1", t: 2 }, { n: "b2", t: 2 }];
    expect(byCaptureTime(l, t).map((x) => x.n)).toEqual(["a", "b1", "b2", "c"]);
  });
  it("Dateien ohne Datum bleiben an ihrem Platz", () => {
    const l = [{ n: "c", t: 3 }, { n: "x", t: null }, { n: "a", t: 1 }];
    expect(byCaptureTime(l, t).map((x) => x.n)).toEqual(["a", "x", "c"]);
  });
  it("sortiert nur innerhalb der Gruppe (Videos bleiben unten)", () => {
    const l = [{ n: "p2", t: 5, v: false }, { n: "p1", t: 4, v: false }, { n: "v1", t: 1, v: true }];
    expect(byCaptureTime(l, t, (x) => x.v).map((x) => x.n)).toEqual(["p1", "p2", "v1"]);
  });
});
