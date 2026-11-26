// Minimaler ZIP-Ersteller (ohne Kompression – Fotos sind bereits komprimiert).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** ZIP speichert Ortszeit ohne Zone. wallClock: Uhrzeit steht in den UTC-Feldern (EXIF-Aufnahmezeit). */
export function dosTime(d: Date, wallClock = false): { time: number; date: number } {
  const [y, mo, day, h, mi, s] = wallClock
    ? [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
    : [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()];
  return {
    time: (h << 11) | (mi << 5) | Math.floor(s / 2),
    date: ((Math.max(1980, y) - 1980) << 9) | ((mo + 1) << 5) | day,
  };
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  date?: Date;
  /** date ist eine Aufnahmezeit (Kamera-Uhrzeit in den UTC-Feldern, wie taken_at) */
  wallClock?: boolean;
}

export function buildZip(entries: ZipEntry[]): Blob {
  const enc = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const { time, date } = e.date ? dosTime(e.date, e.wallClock) : dosTime(new Date());
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // Version
    local.setUint16(6, 0x0800, true); // UTF-8-Namen
    local.setUint16(8, 0, true); // ohne Kompression
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, e.data.length, true);
    local.setUint32(22, e.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer as ArrayBuffer, name as BlobPart, e.data as BlobPart);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, e.data.length, true);
    cd.setUint32(24, e.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    const rec = new Uint8Array(46 + name.length);
    rec.set(new Uint8Array(cd.buffer), 0);
    rec.set(name, 46);
    central.push(rec);
    offset += 30 + name.length + e.data.length;
  }

  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...(central as BlobPart[]), end.buffer as ArrayBuffer], { type: "application/zip" });
}

/**
 * Namen der Dateien im ZIP: Pfad relativ zu basePath (Gross-/Kleinschreibung egal – Drive-Pfade unterscheiden
 * sie nicht überall), sonst nur der Dateiname. Gleiche Namen (auch nur anders gross geschrieben – Windows und
 * macOS unterscheiden das nicht) bekommen „ (2)“, „ (3)“ … vor der Endung, damit sich nichts überschreibt.
 */
export function zipNames(items: { name: string; path?: string | null }[], basePath = ""): string[] {
  const base = basePath.replace(/\/+$/, "");
  const prefix = base ? `${base}/`.toLowerCase() : "";
  const used = new Set<string>();
  return items.map((it) => {
    const full = it.path ?? it.name;
    let name = !prefix ? full : full.toLowerCase().startsWith(prefix) ? full.slice(prefix.length) : it.name;
    name = name.replace(/^\/+/, "") || it.name;
    if (used.has(name.toLowerCase())) {
      const slash = name.lastIndexOf("/");
      const dot = name.lastIndexOf(".");
      const cut = dot > slash + 1 ? dot : name.length;
      for (let n = 2; ; n++) {
        const next = `${name.slice(0, cut)} (${n})${name.slice(cut)}`;
        if (!used.has(next.toLowerCase())) {
          name = next;
          break;
        }
      }
    }
    used.add(name.toLowerCase());
    return name;
  });
}

/** Teilt Dateien in Pakete bis maxBytes bzw. maxCount auf (Reihenfolge bleibt). */
export function chunkBySize<T>(items: T[], sizeOf: (t: T) => number, maxBytes: number, maxCount = Infinity): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  for (const it of items) {
    const s = sizeOf(it);
    if (cur.length && (bytes + s > maxBytes || cur.length >= maxCount)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(it);
    bytes += s;
  }
  if (cur.length) out.push(cur);
  return out;
}
