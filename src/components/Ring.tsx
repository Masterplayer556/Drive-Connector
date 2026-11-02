import { useCountUp } from "../lib/useCountUp";

/** Grosser Fortschrittsring (Upload, Download, Aufräumen). */
export default function Ring({ value, total, label }: { value: number; total: number; label: string }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? Math.min(1, value / total) : 0;
  const shown = useCountUp(value, 400);
  return (
    <div className="progress-ring">
      <svg viewBox="0 0 168 168" width={168} height={168}>
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgb(var(--accent-rgb))" />
            <stop offset="55%" stopColor="rgb(var(--accent3-rgb))" />
            <stop offset="100%" stopColor="rgb(var(--accent2-rgb))" />
          </linearGradient>
        </defs>
        <circle className="track" cx="84" cy="84" r={r} />
        <circle className="value" cx="84" cy="84" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <div className="center">
        <strong>{Math.round(shown)}</strong>
        <span>
          von {total} {label}
        </span>
      </div>
    </div>
  );
}
