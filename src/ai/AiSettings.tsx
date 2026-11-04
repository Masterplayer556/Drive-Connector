// KI-SUCHE (Test): Abschnitt in „Mehr“ – einschalten, Fortschritt sehen, alles wieder löschen.
import "./ai.css";
import { lazy, Suspense, useEffect, useState } from "react";
import type { Account } from "../lib/types";
import Icon from "../components/Icon";
import { useUI } from "../components/ui";
import { crashNote, forgetOldSettings, modelProgress, onModelProgress } from "./engine";
import { setAiEnabled, setFeedbackEnabled, useAiEnabled, useFeedbackEnabled } from "./flag";
import { indexState, onIndexState, setTurbo, stopIndexer, type IndexState } from "./indexer";
import { allNames, removeName } from "./search";
import { usedBytes, wipeEverything } from "./store";

const TrainSheet = lazy(() => import("./TrainSheet"));

const mb = (b: number) => `${Math.round(b / 1e6).toLocaleString("de-CH")} MB`;

/** „noch ca. 1 h 10 min“ aus Restmenge und Tempo. */
function eta(left: number, rate: number): string | null {
  if (!rate || !left) return null;
  const min = Math.ceil(left / rate / 60);
  if (min <= 1) return "noch knapp 1 min";
  if (min < 60) return `noch ca. ${min} min`;
  const h = Math.floor(min / 60);
  const m = Math.round((min % 60) / 5) * 5;
  return `noch ca. ${h} h${m ? ` ${m} min` : ""}`;
}

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
    case "searching":
      return `Pausiert, solange die Suche offen ist · noch ${left.toLocaleString("de-CH")}`;
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

export default function AiSettings({ accounts }: { accounts: Account[] }) {
  const [training, setTraining] = useState(false);
  const ui = useUI();
  const on = useAiEnabled();
  const feedbackOn = useFeedbackEnabled();
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
      title: "KI-Suche (Beta) einschalten?",
      message:
        "Die App lädt einmalig ein KI-Modell (ca. 160 MB – am besten im WLAN) und lernt danach nebenbei deine Fotos kennen, " +
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
      forgetOldSettings();
      await wipeEverything();
      ui.toast("KI-Suche aus – alles gelöscht", "ok");
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  const left = Math.max(0, s.total - s.done);
  const learning = left > 0 && ["start", "model", "indexing", "paused", "searching"].includes(s.phase);

  return (
    <div className="list glass enter">
      <label className="list-item" style={{ cursor: "pointer" }}>
        <span className="li-icon" style={{ background: "linear-gradient(135deg,#f472b6,#8b5cf6)" }}>
          <Icon name="sparkles" size={18} />
        </span>
        <span className="li-text">
          KI-Suche <span className="ai-pill">Beta</span>
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
          {crashNote() && <p className="small ai-note">{crashNote()}</p>}
          <div className="bar">
            <div className={`bar-fill ${s.phase === "indexing" || s.phase === "model" ? "live" : ""}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="ai-settings-meta faint small">
            <span>
              {s.done.toLocaleString("de-CH")} von {s.total.toLocaleString("de-CH")} Fotos bereit
            </span>
            {bytes !== null && bytes >= 1e6 && <span>{mb(bytes)} belegt</span>}
          </div>
          {learning && s.phase === "indexing" && s.rate > 0 && (
            <div className="ai-settings-meta faint small">
              <span>{s.rate.toLocaleString("de-CH", { maximumFractionDigits: 1 })} Fotos/s</span>
              <span>{eta(left, s.rate)}</span>
            </div>
          )}
          {learning && (
            <>
              <button className={`btn small ${s.turbo ? "ghost" : "primary"}`} onClick={() => setTurbo(!s.turbo)}>
                <Icon name="sparkles" size={16} /> {s.turbo ? "Schnell lernen beenden" : "Schnell lernen"}
              </button>
              <p className="faint small" style={{ margin: 0 }}>
                {s.turbo
                  ? "Ohne Pausen – der Bildschirm bleibt an. App offen lassen, am besten am Ladekabel. Endet von selbst, wenn alles fertig ist."
                  : "Lernt nur, solange die App offen ist (iOS erlaubt Web-Apps nichts im Hintergrund), sparsam und mit Pausen, während du sie bedienst."}
              </p>
            </>
          )}
          <label className="ai-toggle small">
            <span>
              <strong>👍/👎-Feedback</strong>
              <span className="faint">
                {feedbackOn
                  ? " Bewertungen bei den Treffern – die Suche lernt daraus."
                  : " Aus – keine Knöpfe mehr. Bisherige Bewertungen wirken weiter."}
              </span>
            </span>
            <span className="switch">
              <input type="checkbox" checked={feedbackOn} onChange={(e) => setFeedbackEnabled(e.target.checked)} />
              <span />
            </span>
          </label>
          <button className="btn small primary" onClick={() => setTraining(true)}>
            <Icon name="sparkles" size={16} /> KI trainieren
          </button>
          <p className="faint small" style={{ margin: 0 }}>
            Begriffe aus deinen Ordnern, Tags und Suchen – Foto nach rechts wischen = passt, nach links = passt nicht.
          </p>
          {training && (
            <Suspense fallback={null}>
              <TrainSheet accounts={accounts} onClose={() => setTraining(false)} />
            </Suspense>
          )}
          <LearnedNames />
          <p className="faint small" style={{ margin: 0 }}>
            Tipp: In der Suche einfach beschreiben, z. B. „Hund im Schnee“ oder „Arbeitsblatt mit Tabelle“.
          </p>
        </div>
      )}
    </div>
  );
}

/** Gelernte Namen (aus 👍 und „Wer ist das?“) – ansehen und vergessen. */
function LearnedNames() {
  const [names, setNames] = useState<{ name: string; label: string; count: number; folders: string[] }[] | null>(null);
  const ui = useUI();
  const load = () => allNames().then(setNames).catch(() => setNames([]));
  useEffect(() => {
    void load();
  }, []);
  if (!names?.length) return null;
  const forget = async (n: { label: string; name: string }) => {
    const ok = await ui.confirm({
      title: `„${n.label}“ vergessen?`,
      message: "Die Fotos bleiben, nur der gelernte Name und seine 👍 werden gelöscht.",
      confirmLabel: "Vergessen",
      danger: true,
    });
    if (!ok) return;
    await removeName(null, n.name);
    await load();
  };
  return (
    <div className="ai-names">
      <div className="ai-names-head">
        <strong className="small">Gelernte Namen</strong>
        <span className="faint small">Suche nach dem Namen zeigt ähnlich aussehende Fotos. Mehr 👍 = besser.</span>
      </div>
      <div className="ai-name-chips">
        {names.map((n) => (
          <span key={n.name} className="ai-name-chip on">
            {n.folders.length > 0 && <Icon name="folder" size={12} />}
            {n.label} <span className="faint">{n.count}</span>
            <button onClick={() => void forget(n)} aria-label={`${n.label} vergessen`}>
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
