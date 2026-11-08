// Geometrie für das Speicher-Diagramm auf der Startseite (eine Form pro Design).

export interface Range {
  /** Anteil am Gesamtspeicher, 0 … 1 */
  from: number;
  to: number;
  color: string;
}

/** Konten nacheinander als Bereiche 0 … 1 (leere Konten fallen weg, nie über 1 hinaus). */
export function toRanges(segments: { value: number; color: string }[], total: number): Range[] {
  if (!(total > 0)) return [];
  const out: Range[] = [];
  let at = 0;
  for (const s of segments) {
    const from = Math.min(1, at);
    const to = Math.min(1, at + Math.max(0, s.value) / total);
    if (to > from) out.push({ from, to, color: s.color });
    at = to;
  }
  return out;
}

/** Farbe an Stelle t (0 … 1) – null, wenn dort freier Speicher ist. */
export function colorAt(ranges: Range[], t: number): string | null {
  for (const r of ranges) if (t >= r.from && t < r.to) return r.color;
  return null;
}

const pt = (cx: number, cy: number, r: number, a: number) => `${round(cx + r * Math.cos(a))} ${round(cy + r * Math.sin(a))}`;
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Bogen im Uhrzeigersinn von Winkel a0 bis a1 (Bogenmass, 0 = rechts, SVG-Koordinaten). */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const sweep = Math.min(a1 - a0, Math.PI * 2 - 1e-4);
  const end = a0 + sweep;
  return `M ${pt(cx, cy, r, a0)} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${pt(cx, cy, r, end)}`;
}

/** Tortenstück von a0 bis a1. */
export function wedgePath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  return `M ${cx} ${cy} L ${arcPath(cx, cy, r, a0, a1).slice(2)} Z`;
}
