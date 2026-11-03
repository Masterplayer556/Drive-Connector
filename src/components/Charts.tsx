// Schlanke Diagramme ohne Bibliothek: dünne Balken mit 4-px-Rundung an der Spitze,
// zurückhaltendes Raster, Antippen zeigt den Wert (Tooltip), Text in Textfarbe.
import { useState } from "react";

export interface BarDatum {
  label: string;
  value: number;
  detail: string;
}

/** Säulen (z. B. Uploads pro Monat) – eine Reihe, eine Farbe, kein Legenden-Kasten nötig. */
export function BarChart({ data, height = 160 }: { data: BarDatum[]; height?: number }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 320;
  const pad = { top: 18, bottom: 22, left: 0, right: 0 };
  const plotH = height - pad.top - pad.bottom;
  const slot = (w - pad.left - pad.right) / Math.max(1, data.length);
  const barW = Math.min(18, slot * 0.6);
  const peak = data.reduce((m, d, i) => (d.value > data[m].value ? i : m), 0);

  return (
    <div className="chart" onPointerLeave={() => setActive(null)}>
      <svg viewBox={`0 0 ${w} ${height}`} width="100%" role="img" aria-label="Säulendiagramm">
        {[0.5, 1].map((t) => (
          <line key={t} className="chart-grid" x1={0} x2={w} y1={pad.top + plotH * (1 - t)} y2={pad.top + plotH * (1 - t)} />
        ))}
        <line className="chart-axis" x1={0} x2={w} y1={pad.top + plotH} y2={pad.top + plotH} />
        {data.map((d, i) => {
          const h = Math.max(d.value > 0 ? 3 : 0, (d.value / max) * plotH);
          const x = pad.left + slot * i + (slot - barW) / 2;
          const y = pad.top + plotH - h;
          return (
            <g key={i}>
              {/* grössere Trefferfläche als der Balken */}
              <rect x={pad.left + slot * i} y={pad.top} width={slot} height={plotH} fill="transparent" onPointerEnter={() => setActive(i)} onClick={() => setActive(i)} />
              <path
                className={`chart-bar ${active === i ? "on" : ""}`}
                d={roundedTop(x, y, barW, h)}
                style={{ animationDelay: `${i * 35}ms` }}
              />
              {(i === peak || i === data.length - 1) && d.value > 0 && (
                <text className="chart-value" x={x + barW / 2} y={y - 5} textAnchor="middle">
                  {d.value}
                </text>
              )}
              <text className="chart-label" x={x + barW / 2} y={height - 6} textAnchor="middle">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {active !== null && data[active] && (
        <div className="chart-tip" style={{ left: `${((slot * active + slot / 2) / w) * 100}%` }}>
          {data[active].detail}
        </div>
      )}
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

/** Horizontale Balken mit Beschriftung (Bereiche, grösste Ordner). */
export function HBars({ rows }: { rows: { label: string; value: number; text: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="hbars">
      {rows.map((r, i) => (
        <div key={r.label + i} className="hbar">
          <div className="row between small">
            <span className="ellipsis">{r.label}</span>
            <span className="muted" style={{ flexShrink: 0 }}>{r.text}</span>
          </div>
          <div className="bar">
            <div className="bar-fill" style={{ width: `${(r.value / max) * 100}%`, transitionDelay: `${i * 60}ms` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Linie mit Fläche (Speicherverlauf) – 2-px-Linie, Fadenkreuz beim Antippen. */
export function AreaLine({ points, height = 140, format }: { points: { x: string; y: number }[]; height?: number; format: (v: number) => string }) {
  const [active, setActive] = useState<number | null>(null);
  const w = 320;
  const top = 14;
  const bottom = 18;
  const plotH = height - top - bottom;
  const min = Math.min(...points.map((p) => p.y));
  const max = Math.max(...points.map((p) => p.y));
  const span = Math.max(1, max - min);
  const xs = (i: number) => (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  const ys = (v: number) => top + plotH - ((v - min) / span) * plotH * 0.85 - plotH * 0.075;
  const line = points.map((p, i) => `${i ? "L" : "M"}${xs(i)},${ys(p.y)}`).join(" ");
  const area = `${line} L${xs(points.length - 1)},${top + plotH} L${xs(0)},${top + plotH} Z`;

  return (
    <div className="chart" onPointerLeave={() => setActive(null)}>
      <svg
        viewBox={`0 0 ${w} ${height}`}
        width="100%"
        role="img"
        aria-label="Verlauf"
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left) / r.width) * (points.length - 1));
          setActive(Math.max(0, Math.min(points.length - 1, i)));
        }}
      >
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--accent3-rgb))" stopOpacity="0.35" />
            <stop offset="100%" stopColor="rgb(var(--accent3-rgb))" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line className="chart-axis" x1={0} x2={w} y1={top + plotH} y2={top + plotH} />
        <path d={area} fill="url(#areaFill)" />
        <path d={line} className="chart-line" />
        {active !== null && (
          <>
            <line className="chart-cross" x1={xs(active)} x2={xs(active)} y1={top} y2={top + plotH} />
            <circle cx={xs(active)} cy={ys(points[active].y)} r={5} className="chart-dot" />
          </>
        )}
        <text className="chart-label" x={2} y={height - 4}>{points[0]?.x}</text>
        <text className="chart-label" x={w - 2} y={height - 4} textAnchor="end">{points[points.length - 1]?.x}</text>
      </svg>
      {active !== null && (
        <div className="chart-tip" style={{ left: `${(xs(active) / w) * 100}%` }}>
          {points[active].x}: {format(points[active].y)}
        </div>
      )}
    </div>
  );
}
