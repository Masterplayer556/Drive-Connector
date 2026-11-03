// KI-SUCHE (Test): Abschnitt in „Mehr“ – einschalten, Fortschritt sehen, alles wieder löschen.
import "./ai.css";
import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import { useUI } from "../components/ui";
import { modelProgress, onModelProgress } from "./engine";
import { setAiEnabled, useAiEnabled } from "./flag";
import { indexState, onIndexState, stopIndexer, type IndexState } from "./indexer";
import { usedBytes, wipeEverything } from "./store";

const mb = (b: number) => `${Math.round(b / 1e6).toLocaleString("de-CH")} MB`;

function statusText(s: IndexState): string {
  const left = Math.max(0, s.total - s.done);
  switch (s.phase) {
    case "start":
      return "Startet …";
    case "model": {
      const p = modelProgress("bild");
      return p && p.total ? `Bildmodell wird geladen … ${Math.round((p.loaded / p.total) * 100)} %` : "Bildmodell wird vorbereitet …";
    }
    case "indexing":
      return `Lernt deine Fotos kennen … noch ${left.toLocaleString("de-CH")}`;
    case "paused":
      return `Pausiert, solange die App im Hintergrund ist · noch ${left.toLocaleString("de-CH")}`;
    case "done":
      return "Alle Fotos bereit";
    case "error":
      return `Problem: ${s.error ?? "unbekannt"} – versucht es später nochmals`;
    default:
      return "Aus";
  }
}

export default function AiSettings() {
  const ui = useUI();
  const on = useAiEnabled();
  const [s, setS] = useState(indexState);
  const [bytes, setBytes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => onIndexState(() => setS(indexState())), []);
  useEffect(() => onModelProgress(() => tick((n) => n + 1)), []);
  useEffect(() => {
    if (!on) return setBytes(null);
    void usedBytes().then(setBytes);
  }, [on, s.phase]);

  const enable = async () => {
    const ok = await ui.confirm({
      title: "KI-Suche testen?",
      message:
        "Die App lädt einmalig ein KI-Modell (ca. 250 MB – am besten im WLAN) und lernt danach nebenbei deine Fotos kennen, " +
        "solange die App offen ist. Alles läuft auf diesem iPhone, keine Fotos oder Suchen gehen an einen KI-Dienst. " +
        "Ausschalten löscht Modell und Index wieder vollständig.",
      confirmLabel: "Einschalten",
    });
    if (ok) setAiEnabled(true);
  };

  const disable = async () => {
    const ok = await ui.confirm({
      title: "KI-Suche ausschalten?",
      message: "Modell und Index werden von diesem Gerät gelöscht. Deine Fotos bleiben unverändert.",
      confirmLabel: "Ausschalten & löschen",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      stopIndexer();
      setAiEnabled(false);
      await wipeEverything();
      ui.toast("KI-Suche aus – alles gelöscht", "ok");
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;

  return (
    <div className="list glass enter">
      <label className="list-item" style={{ cursor: "pointer" }}>
        <span className="li-icon" style={{ background: "linear-gradient(135deg,#f472b6,#8b5cf6)" }}>
          <Icon name="sparkles" size={18} />
        </span>
        <span className="li-text">
          KI-Suche <span className="ai-pill">Test</span>
          <small>{on ? statusText(s) : "Fotos per Beschreibung finden – läuft nur auf diesem Gerät"}</small>
        </span>
        {busy ? (
          <span className="spinner" />
        ) : (
          <span className="switch">
            <input type="checkbox" checked={on} onChange={() => void (on ? disable() : enable())} />
            <span />
          </span>
        )}
      </label>
      {on && (
        <div className="ai-settings-body">
          <div className="bar">
            <div className={`bar-fill ${s.phase === "indexing" || s.phase === "model" ? "live" : ""}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="ai-settings-meta faint small">
            <span>
              {s.done.toLocaleString("de-CH")} von {s.total.toLocaleString("de-CH")} Fotos bereit
            </span>
            {bytes !== null && bytes >= 1e6 && <span>{mb(bytes)} belegt</span>}
          </div>
          <p className="faint small" style={{ margin: 0 }}>
            Tipp: In der Suche einfach beschreiben, z. B. „Hund im Schnee“ oder „Arbeitsblatt mit Tabelle“.
          </p>
        </div>
      )}
    </div>
  );
}
