import { useEffect, useId, useState } from "react";
import { formatBytes } from "../lib/format";
import { useCountUp } from "../lib/useCountUp";

export interface Segment {
  value: number;
  color: string;
  label: string;
}

/** Speicherring: ein farbiges Segment pro Konto; beim Laden füllt ein Bogen den Ring von 0° bis zum Verbrauch. */
export default function Donut({ segments, total, size = 132 }: { segments: Segment[]; total: number; size?: number }) {
  const [shown, setShown] = useState(false);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    // Nach dem Aufdecken ohne Maske zeichnen – sonst wird das Leuchten an den Rändern abgeschnitten
    const t = setTimeout(() => setRevealed(true), 1450);
    return () => {
      cancelAnimationFrame(id);
      clearTimeout(t);
    };
  }, []);

  const used = segments.reduce((s, x) => s + x.value, 0);
  const pct = total > 0 ? (used / total) * 100 : 0;
  const animatedPct = useCountUp(pct);
  const r = 52;
  const c = 2 * Math.PI * r;
  const gap = segments.length > 1 ? 3 : 0;

  const maskId = `donut-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const usedLen = total > 0 ? Math.min(1, used / total) * c : 0;
  // Die Maske beginnt etwas vor 0°, damit das runde Ende des ersten Segments nicht abgeschnitten wird
  const lead = 8;

  let offset = 0;
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg viewBox="-10 -10 140 140" width={size} height={size}>
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="-40" y="-40" width="200" height="200">
            <circle
              className="donut-reveal"
              cx="60"
              cy="60"
              r={r}
              strokeDasharray={`${shown ? usedLen + 2 * lead : 0} ${c + 2 * lead}`}
              strokeDashoffset={lead}
            />
          </mask>
        </defs>
        <circle className="donut-track" cx="60" cy="60" r={r} />
        <g mask={revealed ? undefined : `url(#${maskId})`}>
          {segments.map((s, i) => {
            const len = total > 0 ? Math.max(0, (s.value / total) * c - gap) : 0;
            const el = (
              <circle
                key={i}
                className="donut-seg"
                cx="60"
                cy="60"
                r={r}
                stroke={s.color}
                strokeDasharray={`${len} ${c}`}
                strokeDashoffset={-offset}
              />
            );
            offset += total > 0 ? (s.value / total) * c : 0;
            return el;
          })}
        </g>
      </svg>
      <div className="donut-center">
        {/* Kleines Extra: bei genau 69 % leuchtet die Zahl golden */}
        <strong className={Math.round(pct) === 69 && Math.round(animatedPct) === 69 ? "gold" : undefined}>{Math.round(animatedPct)}%</strong>
        <span>{formatBytes(used)}</span>
      </div>
    </div>
  );
}
