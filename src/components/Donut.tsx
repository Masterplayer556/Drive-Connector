import { useEffect, useId, useState } from "react";
import { arcPath, colorAt, toRanges, wedgePath, type Range } from "../lib/donutGeometry";
import { formatBytes } from "../lib/format";
import { useCountUp } from "../lib/useCountUp";
import { useThemeId } from "../lib/useTheme";

/** Farbe der Prozentzahl: ab 80 % gelb, ab 90 % rot, ab 95 % dunkelrot – und bei genau 69 % golden. */
export function levelClass(pct: number, shown = pct): string | undefined {
  if (pct === 69 && shown === 69) return "gold";
  if (pct >= 95) return "lvl-crit";
  if (pct >= 90) return "lvl-red";
  if (pct >= 80) return "lvl-warn";
  return undefined;
}

export interface Segment {
  value: number;
  color: string;
  label: string;
}

interface Shape {
  ranges: Range[];
  shown: boolean;
  uid: string;
}

const TAU = Math.PI * 2;
const TOP = -Math.PI / 2;

/**
 * Speicher-Diagramm der Startseite: ein Teil pro Konto. Jedes Design hat seine eigene Form –
 * Aurora Ring mit Nordlicht, Sunset Sonne am Horizont, Polar Kompass, Neon Arcade-Anzeige,
 * Riso gedruckte Torte, Tinte Pinselkreis mit Stempel.
 */
export default function Donut({ segments, total, size = 132 }: { segments: Segment[]; total: number; size?: number }) {
  const theme = useThemeId();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const uid = `d${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  const used = segments.reduce((s, x) => s + x.value, 0);
  const pct = total > 0 ? (used / total) * 100 : 0;
  const animatedPct = useCountUp(pct);
  const shape: Shape = { ranges: toRanges(segments, total), shown, uid };

  return (
    <div className={`donut donut-${theme} ${shown ? "shown" : ""}`} style={{ width: size, height: size }}>
      {theme === "sunset" ? (
        <SunGauge {...shape} size={size} />
      ) : theme === "polar" ? (
        <Compass {...shape} size={size} />
      ) : theme === "neon" ? (
        <LedGauge {...shape} size={size} />
      ) : theme === "riso" ? (
        <PrintedPie {...shape} size={size} />
      ) : theme === "tinte" ? (
        <Enso {...shape} size={size} />
      ) : (
        <AuroraRing {...shape} size={size} />
      )}
      <div className="donut-center">
        {/* Kleines Extra: bei genau 69 % leuchtet die Zahl golden */}
        <strong className={levelClass(Math.round(pct), Math.round(animatedPct))}>{Math.round(animatedPct)}%</strong>
        <span>{formatBytes(used)}</span>
      </div>
    </div>
  );
}

/** Verzögerung, damit sich die Teile nacheinander füllen (wie ein Bogen, der wächst). */
const delay = (from: number, total = 1.1) => ({ transitionDelay: `${Math.round(from * total * 1000)}ms` });

/* ---------- Aurora: Ring, dahinter wandert Nordlicht ---------- */
function AuroraRing({ ranges, shown, size }: Shape & { size: number }) {
  const r = 52;
  const gap = ranges.length > 1 ? 3 : 0;
  return (
    <>
      <span className="donut-shimmer" aria-hidden="true" />
      <svg viewBox="-10 -10 140 140" width={size} height={size}>
        <circle className="donut-track" cx="60" cy="60" r={r} />
        {ranges.map((s, i) => {
          const len = Math.max(0.01, (s.to - s.from) * TAU * r - gap);
          return (
            <path
              key={i}
              className="donut-seg"
              d={arcPath(60, 60, r, TOP + s.from * TAU, TOP + s.to * TAU)}
              stroke={s.color}
              strokeDasharray={`${shown ? len : 0} 999`}
              style={delay(s.from)}
            />
          );
        })}
      </svg>
    </>
  );
}

/* ---------- Sunset: Halbkreis-Sonne auf dem Horizont, Spiegelung im Wasser ---------- */
function SunGauge({ ranges, shown, size, uid }: Shape & { size: number }) {
  const cx = 70;
  const cy = 92;
  const r = 63;
  const gap = ranges.length > 1 ? 3 : 0;
  return (
    <svg viewBox="0 0 140 140" width={size} height={size} className="sun-svg">
      <defs>
        <linearGradient id={`${uid}-sun`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset=".5" stopColor="#fb923c" />
          <stop offset="1" stopColor="#f43f5e" />
        </linearGradient>
        <mask id={`${uid}-stripes`}>
          <rect x="0" y="0" width="140" height="140" fill="#fff" />
          {[68, 76, 83, 89].map((y, i) => (
            <rect key={y} x="0" y={y} width="140" height={1.4 + i * 0.7} fill="#000" />
          ))}
        </mask>
      </defs>
      {/* Sonnenscheibe mit Retro-Streifen */}
      <path className="sun-disc" d={`${arcPath(cx, cy, r - 13, Math.PI, TAU)} Z`} fill={`url(#${uid}-sun)`} mask={`url(#${uid}-stripes)`} />
      <path className="donut-track" d={arcPath(cx, cy, r, Math.PI, TAU)} />
      {ranges.map((s, i) => {
        const len = Math.max(0.01, (s.to - s.from) * Math.PI * r - gap);
        return (
          <path
            key={i}
            className="donut-seg"
            d={arcPath(cx, cy, r, Math.PI + s.from * Math.PI, Math.PI + s.to * Math.PI)}
            stroke={s.color}
            strokeDasharray={`${shown ? len : 0} 999`}
            style={delay(s.from)}
          />
        );
      })}
      <line className="sun-horizon" x1="0" y1={cy + 1} x2="140" y2={cy + 1} />
      {/* Spiegelung */}
      {[
        [70, 103, 0.55],
        [48, 112, 0.38],
        [28, 120, 0.24],
        [12, 127, 0.14],
      ].map(([w, y, o]) => (
        <line key={y} className="sun-reflection" x1={cx - w / 2} x2={cx + w / 2} y1={y} y2={y} stroke={`url(#${uid}-sun)`} opacity={o} />
      ))}
    </svg>
  );
}

/* ---------- Polar: Kompass-Ring aus feinen Strichen, Nordnadel oben ---------- */
function Compass({ ranges, shown, size }: Shape & { size: number }) {
  const n = 60;
  return (
    <svg viewBox="-10 -10 140 140" width={size} height={size}>
      <circle className="compass-inner" cx="60" cy="60" r="40" />
      {Array.from({ length: n }, (_, i) => {
        const t = (i + 0.5) / n;
        const color = colorAt(ranges, t);
        const a = TOP + (i / n) * TAU;
        const major = i % 15 === 0;
        const r0 = major ? 43 : 46;
        const r1 = 58;
        return (
          <line
            key={i}
            className={`tick ${color && shown ? "on" : ""} ${major ? "major" : ""}`}
            x1={60 + r0 * Math.cos(a)}
            y1={60 + r0 * Math.sin(a)}
            x2={60 + r1 * Math.cos(a)}
            y2={60 + r1 * Math.sin(a)}
            stroke={color ?? undefined}
            style={{ transitionDelay: `${i * 14}ms` }}
          />
        );
      })}
      <path className="compass-needle" d="M60 -7 L65 2 L55 2 Z" />
    </svg>
  );
}

/* ---------- Neon: Arcade-Anzeige über 270°, LED-Blöcke leuchten nacheinander auf ---------- */
function LedGauge({ ranges, shown, size }: Shape & { size: number }) {
  const n = 30;
  const start = (135 * Math.PI) / 180;
  const sweep = (270 * Math.PI) / 180;
  const step = sweep / n;
  const pad = (2.6 * Math.PI) / 180;
  return (
    <svg viewBox="-10 -10 140 140" width={size} height={size}>
      {Array.from({ length: n }, (_, i) => {
        const color = colorAt(ranges, (i + 0.5) / n);
        const a0 = start + i * step + pad / 2;
        return (
          <path
            key={i}
            className={`led ${color && shown ? "on" : ""}`}
            d={arcPath(60, 60, 52, a0, a0 + step - pad)}
            stroke={color ?? undefined}
            style={{ color: color ?? undefined, transitionDelay: `${i * 28}ms` }}
          />
        );
      })}
    </svg>
  );
}

/* ---------- Riso: gedruckte Torte mit Rasterpunkten, Farbe leicht verrutscht, Etikett in der Mitte ---------- */
function PrintedPie({ ranges, shown, size, uid }: Shape & { size: number }) {
  const r = 54;
  const lead = 8;
  return (
    <svg viewBox="-10 -10 140 140" width={size} height={size}>
      <defs>
        <pattern id={`${uid}-dots`} width="5" height="5" patternUnits="userSpaceOnUse">
          <circle cx="2.5" cy="2.5" r="1.05" fill="rgba(255,255,255,.4)" />
        </pattern>
        <mask id={`${uid}-reveal`} maskUnits="userSpaceOnUse" x="-40" y="-40" width="200" height="200">
          <circle
            className="donut-reveal"
            cx="60"
            cy="60"
            r="30"
            strokeWidth="64"
            strokeDasharray={`${shown ? 2 * Math.PI * 30 + lead : 0} 999`}
            transform="rotate(-90 60 60)"
          />
        </mask>
      </defs>
      <circle cx="64" cy="64" r={r} className="pie-shadow" />
      <circle cx="60" cy="60" r={r} className="pie-paper" />
      <g mask={`url(#${uid}-reveal)`}>
        {/* Farbe verrutscht gegenüber der Tinte – wie beim echten Risodruck */}
        <g transform="translate(-2 -1.5)">
          {ranges.map((s, i) => (
            <g key={i}>
              <path d={wedgePath(60, 60, r, TOP + s.from * TAU, TOP + s.to * TAU)} fill={s.color} />
              <path d={wedgePath(60, 60, r, TOP + s.from * TAU, TOP + s.to * TAU)} fill={`url(#${uid}-dots)`} />
            </g>
          ))}
        </g>
        {ranges.map((s, i) => (
          <path key={i} className="pie-ink" d={wedgePath(60, 60, r, TOP + s.from * TAU, TOP + s.to * TAU)} />
        ))}
      </g>
      <circle cx="60" cy="60" r={r} className="pie-outline" />
      <circle cx="60" cy="60" r="31" className="pie-label" />
    </svg>
  );
}

/* ---------- Tinte: Ensō – ein Pinselkreis, der nie ganz geschlossen ist ---------- */
function Enso({ ranges, shown, size, uid }: Shape & { size: number }) {
  const r = 50;
  const gap = ranges.length > 1 ? 4 : 0;
  return (
    <svg viewBox="-10 -10 140 140" width={size} height={size}>
      <defs>
        <filter id={`${uid}-brush`} x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035 0.6" numOctaves="2" seed="4" result="streak" />
          <feDisplacementMap in="SourceGraphic" in2="streak" scale="5" xChannelSelector="R" yChannelSelector="G" result="moved" />
          <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="1" seed="9" result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.7 1.65" result="holes" />
          <feComposite in="moved" in2="holes" operator="in" />
        </filter>
      </defs>
      <circle className="enso-track" cx="60" cy="60" r={r} />
      <g filter={`url(#${uid}-brush)`}>
        {ranges.map((s, i) => {
          const len = Math.max(0.01, (s.to - s.from) * TAU * r - gap);
          return (
            <path
              key={i}
              className="enso-seg"
              d={arcPath(60, 60, r, TOP + s.from * TAU, TOP + s.to * TAU)}
              stroke={s.color}
              strokeDasharray={`${shown ? len : 0} 999`}
              style={delay(s.from, 1.4)}
            />
          );
        })}
      </g>
    </svg>
  );
}
