// Aufnahmedatum (EXIF DateTimeOriginal) aus einem JPEG lesen – ohne Zusatzbibliothek.

function parseExifDate(s: string): Date | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(y, mo - 1, d, h, mi, se);
}

/** Liest DateTimeOriginal (0x9003), sonst DateTimeDigitized (0x9004), sonst DateTime (0x0132). */
export function exifDateFromBuffer(buf: ArrayBuffer): Date | null {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
  let off = 2;
  while (off + 4 <= v.byteLength) {
    const marker = v.getUint16(off);
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return null;
    const size = v.getUint16(off + 2);
    if (marker === 0xffe1 && off + 10 <= v.byteLength) {
      const isExif =
        v.getUint32(off + 4) === 0x45786966 && // "Exif"
        v.getUint16(off + 8) === 0x0000;
      if (isExif) return readTiff(v, off + 10, Math.min(v.byteLength, off + 2 + size));
    }
    off += 2 + size;
  }
  return null;
}

function readTiff(v: DataView, tiff: number, end: number): Date | null {
  if (tiff + 8 > end) return null;
  const order = v.getUint16(tiff);
  const le = order === 0x4949; // "II"
  if (!le && order !== 0x4d4d) return null;
  const u16 = (o: number) => v.getUint16(o, le);
  const u32 = (o: number) => v.getUint32(o, le);

  const readAscii = (entry: number): string | null => {
    const count = u32(entry + 4);
    const at = count > 4 ? tiff + u32(entry + 8) : entry + 8;
    if (at + count > end) return null;
    let s = "";
    for (let i = 0; i < count; i++) {
      const c = v.getUint8(at + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  };

  const readIfd = (ifd: number): Map<number, number> => {
    const tags = new Map<number, number>();
    if (ifd + 2 > end) return tags;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > end) break;
      tags.set(u16(e), e);
    }
    return tags;
  };

  const ifd0 = readIfd(tiff + u32(tiff + 4));
  const exifPtr = ifd0.get(0x8769);
  if (exifPtr !== undefined) {
    const exif = readIfd(tiff + u32(exifPtr + 8));
    for (const tag of [0x9003, 0x9004]) {
      const e = exif.get(tag);
      const s = e !== undefined ? readAscii(e) : null;
      const d = s ? parseExifDate(s) : null;
      if (d) return d;
    }
  }
  const dt = ifd0.get(0x0132);
  const s = dt !== undefined ? readAscii(dt) : null;
  return s ? parseExifDate(s) : null;
}

/** Aufnahmedatum einer Bilddatei (liest nur die ersten 256 KB). */
export async function photoDate(file: Blob): Promise<Date | null> {
  try {
    return exifDateFromBuffer(await file.slice(0, 256 * 1024).arrayBuffer());
  } catch {
    return null;
  }
}
