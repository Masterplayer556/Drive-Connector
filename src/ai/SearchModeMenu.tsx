// KI-SUCHE (Test): kleines Menü im Suchfeld – mit KI oder nach Namen suchen, und ob die KI-Suche
// auch Fotos aus privaten Konten zeigen darf.
import "./ai.css";
import { useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";

export type SearchMode = "ki" | "name";
const MODE_KEY = "drivepool.ai.mode";

/** Gewählter Suchmodus (bleibt gespeichert, Standard: KI). */
export function useSearchMode(): [SearchMode, (m: SearchMode) => void] {
  const [mode, setMode] = useState<SearchMode>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === "name" ? "name" : "ki";
    } catch {
      return "ki";
    }
  });
  const set = (m: SearchMode) => {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignorieren */
    }
  };
  return [mode, set];
}

export default function SearchModeMenu({
  mode,
  onMode,
  includePrivate,
  onIncludePrivate,
}: {
  mode: SearchMode;
  onMode: (m: SearchMode) => void;
  includePrivate: boolean;
  onIncludePrivate: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Antippen ausserhalb schliesst das Menü
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div className="ai-mode" ref={ref}>
      <button className={`ai-mode-btn ${mode}`} onClick={() => setOpen((o) => !o)} aria-label="Suchart wählen" aria-expanded={open}>
        {mode === "ki" ? <Icon name="sparkles" size={14} /> : <Icon name="search" size={14} />}
        {mode === "ki" ? "KI" : "Name"}
        {mode === "ki" && includePrivate && <span className="ai-mode-priv">+ Privat</span>}
        <Icon name="chevronRight" size={13} className="ai-mode-chev" />
      </button>
      {open && (
        <div className="ai-mode-menu">
          <div className="faint small ai-mode-head">Suchen mit</div>
          <label className="ai-mode-opt">
            <input type="radio" name="ai-mode" checked={mode === "ki"} onChange={() => onMode("ki")} />
            <span>
              <strong>KI</strong>
              <small className="faint">Foto auf Englisch beschreiben, z. B. „dog in the snow“</small>
            </span>
          </label>
          <label className="ai-mode-opt">
            <input type="radio" name="ai-mode" checked={mode === "name"} onChange={() => onMode("name")} />
            <span>
              <strong>Namen</strong>
              <small className="faint">Ordner und Dateinamen, z. B. „Mathe“ oder „IMG_45“</small>
            </span>
          </label>
          <label className={`ai-mode-opt ai-mode-check ${mode !== "ki" ? "off" : ""}`}>
            <input type="checkbox" checked={includePrivate} disabled={mode !== "ki"} onChange={(e) => onIncludePrivate(e.target.checked)} />
            <span>
              <strong>Private Fotos einbeziehen</strong>
              <small className="faint">Nur für die KI-Suche – gilt, bis du die Suche schliesst</small>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
