// KI-SUCHE: kleines Menü im Suchfeld – mit KI, nach Namen oder nach Text im Bild suchen, und ob die
// Suche auch Fotos aus privaten Konten zeigen darf.
import "./ai.css";
import { useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";

export type SearchMode = "ki" | "name" | "text";
const MODE_KEY = "drivepool.ai.mode";

/** Gewählter Suchmodus (bleibt gespeichert, Standard: KI). */
export function useSearchMode(): [SearchMode, (m: SearchMode) => void] {
  const [mode, setMode] = useState<SearchMode>(() => {
    try {
      const m = localStorage.getItem(MODE_KEY);
      return m === "name" || m === "text" ? m : "ki";
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
  ai = true,
  includePrivate,
  onIncludePrivate,
}: {
  mode: SearchMode;
  /** KI-Suche eingeschaltet? Sonst nur Namen und Text im Bild */
  ai?: boolean;
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
        {mode === "ki" ? <Icon name="sparkles" size={14} /> : mode === "text" ? <Icon name="pencil" size={14} /> : <Icon name="search" size={14} />}
        {mode === "ki" ? "KI" : mode === "text" ? "Text" : "Name"}
        {mode !== "name" && includePrivate && <span className="ai-mode-priv">+ Privat</span>}
        <Icon name="chevronRight" size={13} className="ai-mode-chev" />
      </button>
      {open && (
        <div className="ai-mode-menu">
          <div className="faint small ai-mode-head">Suchen mit</div>
          {ai && (
            <label className="ai-mode-opt">
              <input type="radio" name="ai-mode" checked={mode === "ki"} onChange={() => onMode("ki")} />
              <span>
                <strong>KI</strong>
                <small className="faint">Foto auf Englisch beschreiben, z. B. „dog in the snow“</small>
              </span>
            </label>
          )}
          <label className="ai-mode-opt">
            <input type="radio" name="ai-mode" checked={mode === "name"} onChange={() => onMode("name")} />
            <span>
              <strong>Namen</strong>
              <small className="faint">Ordner und Dateinamen, z. B. „Mathe“ oder „IMG_45“</small>
            </span>
          </label>
          <label className="ai-mode-opt">
            <input type="radio" name="ai-mode" checked={mode === "text"} onChange={() => onMode("text")} />
            <span>
              <strong>Text im Bild</strong>
              <small className="faint">Was auf dem Foto steht, z. B. „Pythagoras“ auf einem Arbeitsblatt</small>
            </span>
          </label>
          <label className={`ai-mode-opt ai-mode-check ${mode === "name" ? "off" : ""}`}>
            <input type="checkbox" checked={includePrivate} disabled={mode === "name"} onChange={(e) => onIncludePrivate(e.target.checked)} />
            <span>
              <strong>Private Fotos einbeziehen</strong>
              <small className="faint">Für KI-Suche und Text im Bild – gilt, bis du die Suche schliesst</small>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
