// KI-SUCHE: Abschnitt in „Mehr“ – einschalten, Fortschritt sehen. Löschen: Mehr → Sicherheit (AiWipeSheet, mit 2FA).
import "./ai.css";
import { lazy, Suspense, useEffect, useState } from "react";
import type { Account } from "../lib/types";
import Icon from "../components/Icon";
import { useUI } from "../components/ui";
import { crashNote, modelProgress, onModelProgress, visionDevice } from "./engine";
import {
  isAppleMobile,
  setAiEnabled,
  setAiModel,
  setFeedbackEnabled,
  setKombi,
  setLearningDevice,
  useAiEnabled,
  useAiModel,
  useFeedbackEnabled,
  useKombi,
  useLearningDevice,
} from "./flag";
import { MODEL_IDS, MODELS, type ModelId } from "./protocol";

const MODEL_INFO: Record<ModelId, string> = {
  clip: "OpenAI CLIP (2021) – lernt alle Fotos, auch auf dem iPhone",
  mobileclip2b:
    "Apple MobileCLIP2-B (2025) – laut Apple genauer als Standard. Nur am PC lernbar (ca. 350 MB); das iPhone sucht mit einem kleinen Textteil (65 MB)",
};
import {
  cloudLearning,
  indexState,
  onIndexState,
  resumeLearning,
  setTurbo,
  startCloudLearning,
  stopCloudLearning,
  stopIndexer,
  type IndexState,
} from "./indexer";
import { allNames, removeName } from "./search";
import { usedBytes } from "./store";

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
    case "syncing":
      return "Holt, was der PC gelernt hat …";
    case "cloud":
      return `Wird am PC gelernt · ${s.done.toLocaleString("de-CH")} von ${s.total.toLocaleString("de-CH")} da`;
    case "ready":
      return `${left.toLocaleString("de-CH")} neue Fotos – „Neue Fotos lernen“ drücken`;
    case "held":
      return `Angehalten – die App ist beim Lernen abgestürzt · noch ${left.toLocaleString("de-CH")}`;
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
  const model = useAiModel();
  const feedbackOn = useFeedbackEnabled();
  const [s, setS] = useState(indexState);
  const [bytes, setBytes] = useState<number | null>(null);
  const [, tick] = useState(0);

  useEffect(() => onIndexState(() => setS(indexState())), []);
  useEffect(() => onModelProgress(() => tick((n) => n + 1)), []);
  // Auch ausgeschaltet: zeigen, ob noch gelernte Daten auf dem Gerät liegen (dann geht Einschalten sofort)
  useEffect(() => {
    void usedBytes().then(setBytes);
  }, [on, s.phase]);
  const kept = !on && bytes !== null && bytes >= 1e6;

  const enable = async () => {
    // Schon gelernt (nur deaktiviert) → ohne Rückfrage wieder an, nichts wird neu geladen
    if (kept) {
      setAiEnabled(true);
      ui.toast("KI-Suche wieder an – alles Gelernte ist noch da", "ok");
      return;
    }
    const ok = await ui.confirm({
      title: "KI-Suche einschalten?",
      message:
        "Die App lädt einmalig ein KI-Modell (ca. 160 MB – am besten im WLAN) und lernt danach nebenbei deine Fotos kennen, " +
        "solange die App offen ist. Alles läuft auf diesem iPhone, keine Fotos oder Suchen gehen an einen KI-Dienst. " +
        "Ausschalten deaktiviert sie nur; löschen kannst du alles separat.",
      confirmLabel: "Einschalten",
    });
    if (ok) setAiEnabled(true);
  };

  /** Nur deaktivieren: Modell, gelernte Fotos, 👍/👎 und Namen bleiben auf dem Gerät. */
  const disable = () => {
    stopIndexer();
    setAiEnabled(false);
    ui.toast("KI-Suche deaktiviert – das Gelernte bleibt gespeichert", "ok");
  };

  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  const left = Math.max(0, s.total - s.done);
  const cloud = MODELS[model].cloud;
  // Beim Cloud-Modell (MobileCLIP) gibt es kein „Schnell lernen“ – gelernt wird am PC per Knopf
  const learning = !cloud && left > 0 && ["start", "model", "indexing", "paused", "searching", "held"].includes(s.phase);

  return (
    <div className="list glass enter">
      <label className="list-item" style={{ cursor: "pointer" }}>
        <span className="li-icon" style={{ background: "linear-gradient(135deg,#f472b6,#8b5cf6)" }}>
          <Icon name="sparkles" size={18} />
        </span>
        <span className="li-text">
          KI-Suche
          <small>
            {on
              ? statusText(s)
              : kept
                ? `Deaktiviert – Gelerntes bleibt gespeichert (${mb(bytes!)})`
                : "Fotos per Beschreibung finden – läuft nur auf diesem Gerät"}
          </small>
        </span>
        <span className="switch">
          <input type="checkbox" checked={on} onChange={() => (on ? disable() : void enable())} />
          <span />
        </span>
      </label>
      {kept && (
        <div className="ai-settings-body">
          <p className="faint small" style={{ margin: 0 }}>
            Ganz löschen: Mehr → Sicherheit → KI-Daten löschen.
          </p>
        </div>
      )}
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
          {s.phase === "held" && (
            <>
              <p className="small ai-note" style={{ margin: 0 }}>
                Die App ist beim Lernen abgestürzt (zu wenig Arbeitsspeicher). Damit das nicht immer wieder passiert, lernt sie erst
                weiter, wenn du es sagst.
              </p>
              <button className="btn small" onClick={resumeLearning}>
                Weiter lernen
              </button>
            </>
          )}
          {cloud && <CloudPanel s={s} left={left} />}
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
            Begriffe, die oft auf deinen Fotos vorkommen – Foto nach rechts wischen = passt, nach links = passt nicht.
          </p>
          {training && (
            <Suspense fallback={null}>
              <TrainSheet accounts={accounts} onClose={() => setTraining(false)} />
            </Suspense>
          )}
          <ModelChoice />
          <LearnedNames />
          <p className="faint small" style={{ margin: 0 }}>
            Tipp: In der Suche einfach beschreiben, auf Englisch, z. B. „dog in the snow“ oder „worksheet with a table“.
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
    <details className="ai-names ai-fold">
      <summary className="ai-names-head">
        <strong className="small">
          Gelernte Namen <span className="faint">({names.length})</span>
        </strong>
        <span className="faint small">Suche nach dem Namen zeigt ähnlich aussehende Fotos. Mehr 👍 = besser.</span>
      </summary>
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
    </details>
  );
}

/** Modell wählen: Standard oder MobileCLIP (Test). */
function ModelChoice() {
  const model = useAiModel();
  const kombiOn = useKombi();
  return (
    <details className="ai-names ai-fold">
      <summary className="ai-names-head">
        <strong className="small">
          Modell <span className="faint">({MODELS[model].label})</span>
        </strong>
        <span className="faint small">Jedes Modell hat seinen eigenen Index – Umschalten löscht nichts.</span>
      </summary>
      {MODEL_IDS.map((m) => (
        <label key={m} className="ai-mode-opt">
          <input type="radio" name="ai-model" checked={model === m} onChange={() => setAiModel(m)} />
          <span>
            <strong>{MODELS[m].label}</strong>
            <small className="faint">
              {MODEL_INFO[m]}
            </small>
          </span>
        </label>
      ))}
      {MODELS[model].cloud && (
        <label className="ai-toggle small">
          <span>
            <strong>Kombi mit Standard</strong>
            <span className="faint">
              {kombiOn
                ? " An – die Suche fragt beide Modelle und rechnet sie zusammen (meist genauer als jedes allein)."
                : " Aus – nur das gewählte Modell."}
            </span>
          </span>
          <span className="switch">
            <input type="checkbox" checked={kombiOn} onChange={(e) => setKombi(e.target.checked)} />
            <span />
          </span>
        </label>
      )}
    </details>
  );
}

/** MobileCLIP: am PC per Knopf lernen (genaues Modell), auf dem iPhone nur herunterladen. */
function CloudPanel({ s, left }: { s: IndexState; left: number }) {
  const learner = useLearningDevice();
  const phone = isAppleMobile();
  const running = cloudLearning() && ["model", "indexing", "start", "syncing"].includes(s.phase);
  const dev = visionDevice();
  return (
    <div className="ai-names">
      {phone ? (
        <span className="faint small">
          Dieses Modell lernt nur am PC (dort „Neue Fotos lernen“ drücken). Das iPhone holt die Ergebnisse beim Öffnen und sucht
          damit. Fotos selbst scannen geht hier nur mit dem Standardmodell.
        </span>
      ) : (
        <label className="ai-toggle small">
          <span>
            <strong>Dieses Gerät lernt für alle</strong>
            <span className="faint">
              {learner
                ? " An – hier wird mit dem genauen Modell gelernt (PC). Die Ergebnisse (nur Zahlen) gehen in deine Datenbank."
                : " Aus – dieses Gerät lädt nur herunter, was der PC gelernt hat, und sucht damit."}
            </span>
          </span>
          <span className="switch">
            <input type="checkbox" checked={learner} onChange={(e) => setLearningDevice(e.target.checked)} />
            <span />
          </span>
        </label>
      )}
      {learner &&
        (running ? (
          <>
            <button className="btn small" onClick={stopCloudLearning}>
              Anhalten
            </button>
            <span className="faint small">
              {s.phase === "model" ? "Modell wird geladen …" : `Lernt … noch ${left.toLocaleString("de-CH")}`}
              {s.rate > 0 && ` · ${s.rate.toLocaleString("de-CH", { maximumFractionDigits: 1 })} Fotos/s`}
              {dev && ` · rechnet auf ${dev === "webgpu" ? "der Grafikkarte" : "dem Prozessor"}`}
            </span>
          </>
        ) : (
          <>
            <button className="btn small primary" disabled={left === 0} onClick={startCloudLearning}>
              <Icon name="sparkles" size={16} /> Neue Fotos lernen{left > 0 ? ` (${left.toLocaleString("de-CH")})` : ""}
            </button>
            <span className="faint small">
              {left === 0 ? "Alles gelernt. Neue Fotos lernt es erst, wenn du hier drückst." : "Startet nur auf Knopfdruck. App offen lassen, bis es fertig ist."}
            </span>
          </>
        ))}
      {s.error && <span className="faint small">Hinweis: {s.error}</span>}
    </div>
  );
}
