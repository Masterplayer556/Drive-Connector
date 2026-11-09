import { useEffect, useState } from "react";
import Icon, { type IconName } from "../components/Icon";
import { LineSkeleton } from "../components/Skeleton";
import Topbar from "../components/Topbar";
import { withAppChanges } from "../lib/appChanges";
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
  { kind: "check", label: "Prüfungen" },
  { kind: "error", label: "Fehler" },
  { kind: "app", label: "App-Updates" },
];

const STYLE: Record<LogKind, { icon: IconName; bg: string }> = {
  upload: { icon: "upload", bg: "linear-gradient(135deg,#8b5cf6,#3b82f6)" },
  rename: { icon: "pencil", bg: "linear-gradient(135deg,#f59e0b,#f97316)" },
  delete: { icon: "trash", bg: "linear-gradient(135deg,#f43f5e,#be123c)" },
  move: { icon: "chevronRight", bg: "linear-gradient(135deg,#14b8a6,#0ea5e9)" },
  folder: { icon: "folder", bg: "linear-gradient(135deg,#22d3ee,#3b82f6)" },
  account: { icon: "cloud", bg: "linear-gradient(135deg,#4ade80,#16a34a)" },
  sync: { icon: "refresh", bg: "linear-gradient(135deg,#60a5fa,#6366f1)" },
  error: { icon: "alert", bg: "linear-gradient(135deg,#fb7185,#e11d48)" },
  setup: { icon: "compass", bg: "linear-gradient(135deg,#a78bfa,#ec4899)" },
  check: { icon: "checkCircle", bg: "linear-gradient(135deg,#4ade80,#0d9488)" },
  app: { icon: "sparkles", bg: "linear-gradient(135deg,#0ea5e9,#22c55e)" },
};

export default function ProtokollView() {
  const [kind, setKind] = useState<LogKind | null>(null);
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    setEntries(null);
    // App-Updates stehen nicht in der Datenbank, sondern kommen aus der Git-Historie (beim Bauen eingelesen)
    (kind === "app" ? Promise.resolve(withAppChanges([])) : fetchLog(kind).then((e) => (kind ? e : withAppChanges(e))))
      .then(setEntries)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [kind]);

  return (
    <div className="view page-fade">
      <Topbar eyebrow="Alles, was passiert ist" title="Protokoll" />
      <div className="chips">
        {FILTERS.map((f) => (
          <button key={f.label} className={`chip ${kind === f.kind ? "on" : ""}`} onClick={() => setKind(f.kind)}>
            {f.label}
          </button>
        ))}
      </div>
      {error && (
        <div className="banner error">
          <Icon name="alert" size={18} />
          {error}
        </div>
      )}
      {entries === null ? (
        <LineSkeleton count={8} />
      ) : entries.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            <Icon name="activity" size={32} />
          </div>
          <strong>Noch keine Einträge</strong>
        </div>
      ) : (
        <ul className="timeline stagger">
          {entries.map((e, i) => {
            const st = STYLE[e.kind] ?? STYLE.sync;
            return (
              <li key={e.id} style={{ ["--i" as string]: i }} onClick={() => setOpen(open === e.id ? null : e.id)}>
                <span className="tl-icon" style={{ background: st.bg }}>
                  <Icon name={st.icon} size={18} />
                </span>
                <div className="tl-body glass">
                  <div>{e.message}</div>
                  <div className="faint small">{formatDateTime(e.created_at)}</div>
                  {open === e.id && e.details != null && (
                    <pre className="tl-details">{JSON.stringify(e.details, null, 2)}</pre>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
