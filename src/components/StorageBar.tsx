import { formatBytes } from "../lib/format";

export default function StorageBar({ used, total, color }: { used: number; total: number; color?: string }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="bar">
        <div
          className="bar-fill"
          style={{ width: `${pct}%`, ...(color ? { background: color, boxShadow: `0 0 12px ${color}` } : {}) }}
        />
      </div>
      <div className="row between small muted">
        <span>
          {formatBytes(used)} von {formatBytes(total)}
        </span>
        <span>{formatBytes(Math.max(0, total - used))} frei</span>
      </div>
    </div>
  );
}
