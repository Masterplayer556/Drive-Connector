import { useEffect, useState } from "react";
import { fetchLog } from "../lib/db";
import { formatDateTime } from "../lib/format";
import type { LogEntry, LogKind } from "../lib/types";

const FILTERS: { kind: LogKind | null; label: string }[] = [
  { kind: null, label: "Alle" },
  { kind: "upload", label: "Uploads" },
  { kind: "rename", label: "Umbenennungen" },
  { kind: "delete", label: "Löschungen" },
  { kind: "folder", label: "Ordner" },
  { kind: "setup", label: "Einrichtung" },
  { kind: "account", label: "Konten" },
  { kind: "error", label: "Fehler" },
];

const ICON: Record<LogKind, string> = {
  upload: "⬆️",
  rename: "✏️",
  delete: "🗑️",
  move: "↔️",
  folder: "📁",
  account: "☁️",
  sync: "🔄",
  error: "⚠️",
  setup: "🧭",
};

export default function ProtokollView() {
  const [kind, setKind] = useState<LogKind | null>(null);
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    setEntries(null);
    fetchLog(kind)
      .then(setEntries)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [kind]);

  return (
    <div className="view">
      <header className="header">
        <h2>Protokoll</h2>
      </header>
      <div className="chips">
        {FILTERS.map((f) => (
          <button key={f.label} className={`chip ${kind === f.kind ? "on" : ""}`} onClick={() => setKind(f.kind)}>
            {f.label}
          </button>
        ))}
      </div>
      {error && <div className="banner error">{error}</div>}
      {entries === null ? (
        <p className="muted pad">Lädt …</p>
      ) : entries.length === 0 ? (
        <p className="muted pad">Noch keine Einträge.</p>
      ) : (
        <ul className="log">
          {entries.map((e) => (
            <li key={e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
              <span className="log-icon">{ICON[e.kind] ?? "•"}</span>
              <div className="log-body">
                <div>{e.message}</div>
                <div className="muted small">{formatDateTime(e.created_at)}</div>
                {open === e.id && e.details != null && (
                  <pre className="log-details">{JSON.stringify(e.details, null, 2)}</pre>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
