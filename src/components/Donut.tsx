import { useEffect, useState } from "react";
import { formatBytes } from "../lib/format";
import { useCountUp } from "../lib/useCountUp";

export interface Segment {
  value: number;
  color: string;
  label: string;
}

/** Animierter Speicherring: ein farbiges Segment pro Konto. */
export default function Donut({ segments, total, size = 132 }: { segments: Segment[]; total: number; size?: number }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const used = segments.reduce((s, x) => s + x.value, 0);
  const pct = total > 0 ? (used / total) * 100 : 0;
  const animatedPct = useCountUp(pct);
  const r = 52;
  const c = 2 * Math.PI * r;
  const gap = segments.length > 1 ? 3 : 0;

  let offset = 0;
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" width={size} height={size}>
        <circle className="donut-track" cx="60" cy="60" r={r} />
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
              strokeDasharray={`${shown ? len : 0} ${c}`}
              strokeDashoffset={-offset}
              style={{ transitionDelay: `${i * 90}ms` }}
            />
          );
          offset += (total > 0 ? (s.value / total) * c : 0);
          return el;
        })}
      </svg>
      <div className="donut-center">
        <strong>{Math.round(animatedPct)}%</strong>
        <span>{formatBytes(used)}</span>
      </div>
    </div>
  );
}
