import { formatBytes } from "../lib/format";

export default function StorageBar({ used, total, label }: { used: number; total: number; label?: string }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const level = pct >= 95 ? "crit" : pct >= 80 ? "warn" : "";
  return (
    <div className="storage">
      {label && <div className="storage-label">{label}</div>}
      <div className={`bar ${level}`}>
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="storage-text muted">
        {formatBytes(used)} von {formatBytes(total)} belegt · {formatBytes(Math.max(0, total - used))} frei
      </div>
    </div>
  );
}
