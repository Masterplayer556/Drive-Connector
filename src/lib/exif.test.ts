import { describe, expect, it } from "vitest";
import { exifDateFromBuffer } from "./exif";

/** Baut ein minimales JPEG mit EXIF (IFD0 → ExifIFD → DateTimeOriginal). */
function jpegWithExif(date: string, littleEndian = true): ArrayBuffer {
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
  w16(1);
  w16(0x9003); w16(2); w32(20); w32(44); // Text bei 44
  w32(0);
  for (const c of date) tiff.push(c.charCodeAt(0));
  tiff.push(0);
  const app1Len = 2 + 6 + tiff.length;
  const bytes = [0xff, 0xd8, 0xff, 0xe1, app1Len >> 8, app1Len & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff, 0xff, 0xda];
  return new Uint8Array(bytes).buffer;
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
