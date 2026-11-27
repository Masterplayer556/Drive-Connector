// Aufnahmedatum lesen – ohne Zusatzbibliothek: EXIF aus JPEG/HEIC/PNG, XMP als Notlösung, bei Videos das
// Erstelldatum aus dem MP4/MOV-Kopf (mvhd).
import { isVideo } from "./media";

/** „2024:07:15 18:30:05“ (+ Sekundenbruchteile „123“ aus SubSecTime…) → lokale Zeit */
function parseExifDate(s: string, subsec?: string | null): Date | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const frac = /^\d+/.exec(subsec?.trim() ?? "")?.[0];
  const ms = frac ? Math.round(Number(`0.${frac}`) * 1000) % 1000 : 0;
  return new Date(y, mo - 1, d, h, mi, se, ms);
}

/**
 * Liest DateTimeOriginal (0x9003), sonst DateTimeDigitized (0x9004), sonst DateTime (0x0132) – jeweils mit
 * Sekundenbruchteilen, damit schnell hintereinander gemachte Fotos richtig sortiert werden.
 * JPEG direkt; HEIC/PNG/sonstige über den EXIF-Block im Dateianfang, zuletzt über XMP.
 */
export function exifDateFromBuffer(buf: ArrayBuffer): Date | null {
  return jpegExifDate(buf) ?? embeddedExifDate(buf) ?? xmpDate(buf);
}

function jpegExifDate(buf: ArrayBuffer): Date | null {
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
    // Datum-Tag → passender SubSecTime-Tag
    for (const [tag, sub] of [[0x9003, 0x9291], [0x9004, 0x9292]]) {
      const e = exif.get(tag);
      const s = e !== undefined ? readAscii(e) : null;
      const se = exif.get(sub);
      const d = s ? parseExifDate(s, se !== undefined ? readAscii(se) : null) : null;
      if (d) return d;
    }
  }
  const dt = ifd0.get(0x0132);
  const s = dt !== undefined ? readAscii(dt) : null;
  return s ? parseExifDate(s) : null;
}

const isTiffAt = (v: DataView, o: number) =>
  o + 8 <= v.byteLength && (v.getUint32(o) === 0x49492a00 || v.getUint32(o) === 0x4d4d002a); // "II*\0" / "MM\0*"

/** EXIF-Block irgendwo im Dateianfang (HEIC: „Exif\0\0“ + TIFF; PNG: eXIf-Chunk mit TIFF). */
function embeddedExifDate(buf: ArrayBuffer): Date | null {
  const v = new DataView(buf);
  const b = new Uint8Array(buf);
  for (let i = 0; i + 12 <= b.length; i++) {
    let tiff = -1;
    // "Exif\0\0"
    if (b[i] === 0x45 && b[i + 1] === 0x78 && b[i + 2] === 0x69 && b[i + 3] === 0x66 && !b[i + 4] && !b[i + 5]) tiff = i + 6;
    // PNG-Chunk "eXIf"
    else if (b[i] === 0x65 && b[i + 1] === 0x58 && b[i + 2] === 0x49 && b[i + 3] === 0x66) tiff = i + 4;
    if (tiff >= 0 && isTiffAt(v, tiff)) {
      const d = readTiff(v, tiff, v.byteLength);
      if (d) return d;
    }
  }
  return null;
}

/** XMP (z. B. in Bildschirmfotos): exif:DateTimeOriginal, photoshop:DateCreated oder xmp:CreateDate. */
function xmpDate(buf: ArrayBuffer): Date | null {
  const text = new TextDecoder("latin1").decode(buf);
  for (const tag of ["exif:DateTimeOriginal", "photoshop:DateCreated", "xmp:CreateDate"]) {
    const m = new RegExp(`${tag}(?:="|>)(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d+))?)?(Z|[+-]\\d{2}:?\\d{2})?`).exec(text);
    if (!m) continue;
    const [y, mo, d, h, mi] = m.slice(1, 6).map(Number);
    const se = Number(m[6] ?? 0);
    const ms = m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) % 1000 : 0;
    if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    if (!m[8]) return new Date(y, mo - 1, d, h, mi, se, ms);
    const tz = m[8] === "Z" ? 0 : (m[8][0] === "-" ? -1 : 1) * (Number(m[8].slice(1, 3)) * 60 + Number(m[8].slice(-2)));
    return new Date(Date.UTC(y, mo - 1, d, h, mi, se, ms) - tz * 60_000);
  }
  return null;
}

/** Aufnahmedatum einer Bilddatei (liest nur die ersten 256 KB). */
export async function photoDate(file: Blob): Promise<Date | null> {
  try {
    return exifDateFromBuffer(await file.slice(0, 256 * 1024).arrayBuffer());
  } catch {
    return null;
  }
}

// Sekunden zwischen 1904-01-01 (QuickTime/MP4) und 1970-01-01
const MAC_EPOCH = 2082844800;

/** Erstellzeit aus dem Inhalt eines moov-Atoms (ohne dessen Kopf): Kind-Box „mvhd“. */
export function mvhdDateFromMoov(buf: ArrayBuffer): Date | null {
  const v = new DataView(buf);
  let off = 0;
  while (off + 8 <= v.byteLength) {
    const size = v.getUint32(off);
    const type = v.getUint32(off + 4);
    if (type === 0x6d766864) {
      // "mvhd": Version (1 Byte) + Flags (3 Bytes), danach creation_time (32 oder 64 Bit)
      if (off + 20 > v.byteLength) return null;
      const secs = v.getUint8(off + 8) === 1 ? Number(v.getBigUint64(off + 12)) : v.getUint32(off + 12);
      return secs > MAC_EPOCH ? new Date((secs - MAC_EPOCH) * 1000) : null;
    }
    if (size < 8) return null;
    off += size;
  }
  return null;
}

/** Erstelldatum eines MP4/MOV-Videos (liest nur die Box-Köpfe und das moov-Atom). */
export async function videoDate(file: Blob): Promise<Date | null> {
  try {
    let off = 0;
    for (let n = 0; n < 64 && off + 8 <= file.size; n++) {
      const h = new DataView(await file.slice(off, off + 16).arrayBuffer());
      let size = h.getUint32(0);
      let head = 8;
      if (size === 1 && h.byteLength >= 16) {
        size = Number(h.getBigUint64(8));
        head = 16;
      } else if (size === 0) size = file.size - off;
      if (size < head) return null;
      if (h.getUint32(4) === 0x6d6f6f76) {
        // "moov" – meist klein; mvhd steht ganz vorne darin
        return mvhdDateFromMoov(await file.slice(off + head, off + Math.min(size, 1024 * 1024)).arrayBuffer());
      }
      off += size;
    }
  } catch {
    /* kein lesbares MP4/MOV */
  }
  return null;
}

/** Aufnahme-/Erstellzeit eines Fotos oder Videos – null, wenn die Datei keine enthält. */
export function captureDate(file: File): Promise<Date | null> {
  return isVideo(file) ? videoDate(file) : photoDate(file);
}

/**
 * Reihenfolge wie in der Fotos-App: nach Aufnahmezeit (älteste zuerst). iOS gibt die ausgewählten Fotos nicht in
 * der Auswahl-Reihenfolge weiter, sondern durcheinander.
 * - Nur innerhalb derselben Gruppe sortiert (z. B. Fotos und Videos getrennt – Videos bleiben unten).
 * - Dateien ohne Datum bleiben an ihrem Platz; die datierten werden auf die Plätze der datierten verteilt.
 * - Gleiche Zeit: ursprüngliche Reihenfolge bleibt.
 */
export function byCaptureTime<T>(list: T[], time: (x: T) => number | null, group: (x: T) => unknown = () => 0): T[] {
  const out = [...list];
  const slots = new Map<unknown, number[]>();
  list.forEach((x, i) => {
    if (time(x) === null) return;
    const g = group(x);
    slots.set(g, [...(slots.get(g) ?? []), i]);
  });
  for (const idx of slots.values()) {
    const sorted = [...idx].sort((a, b) => time(list[a])! - time(list[b])! || a - b);
    idx.forEach((slot, k) => (out[slot] = list[sorted[k]]));
  }
  return out;
}
