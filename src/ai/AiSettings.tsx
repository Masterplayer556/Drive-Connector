// KI-SUCHE (Test): Abschnitt in „Mehr“ – einschalten, Fortschritt sehen, alles wieder löschen.
import "./ai.css";
import { lazy, Suspense, useEffect, useState } from "react";
import type { Account } from "../lib/types";
import Icon from "../components/Icon";
import { useUI } from "../components/ui";
import { crashNote, forgetOldSettings, modelProgress, onModelProgress } from "./engine";
import {
  inTestFolders,
  setAiEnabled,
  setAiModel,
  setFeedbackEnabled,
  setTestFolders,
  useAiEnabled,
  useAiModel,
  useFeedbackEnabled,
  useTestFolders,
} from "./flag";
import { catalog } from "./catalog";
import { MODELS } from "./protocol";
import { indexState, onIndexState, setTurbo, stopIndexer, type IndexState } from "./indexer";
import { allNames, removeName } from "./search";
import { usedBytes, wipeEverything } from "./store";

const TrainSheet = lazy(() => import("./TrainSheet"));
const CompareSheet = lazy(() => import("./CompareSheet"));

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
    case "waiting":
      return `Lernt mit diesem Modell nur bei „Schnell lernen“ · noch ${left.toLocaleString("de-CH")}`;
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
      title: "KI-Suche (Beta) einschalten?",
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

  /** Alles von diesem Gerät löschen (Modell, Index, Bewertungen, Namen). */
  const wipe = async () => {
    const ok = await ui.confirm({
      title: "KI-Daten löschen?",
      message:
        "Modell, gelernte Fotos, 👍/👎 und gelernte Namen werden von diesem Gerät gelöscht. Beim nächsten Einschalten lädt und lernt die KI " +
        "alles neu. Deine Fotos und Tags bleiben unverändert.",
      confirmLabel: "Alles löschen",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      stopIndexer();
      setAiEnabled(false);
      forgetOldSettings();
      await wipeEverything();
      setBytes(null);
      ui.toast("KI-Daten gelöscht", "ok");
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  const left = Math.max(0, s.total - s.done);
  const learning = left > 0 && ["start", "model", "indexing", "paused", "searching", "waiting"].includes(s.phase);

  return (
    <div className="list glass enter">
      <label className="list-item" style={{ cursor: "pointer" }}>
        <span className="li-icon" style={{ background: "linear-gradient(135deg,#f472b6,#8b5cf6)" }}>
          <Icon name="sparkles" size={18} />
        </span>
        <span className="li-text">
          KI-Suche <span className="ai-pill">Beta</span>
          <small>
            {on
              ? statusText(s)
              : kept
                ? `Deaktiviert – Gelerntes bleibt gespeichert (${mb(bytes!)})`
                : "Fotos per Beschreibung finden – läuft nur auf diesem Gerät"}
          </small>
        </span>
        {busy ? (
          <span className="spinner" />
        ) : (
          <span className="switch">
            <input type="checkbox" checked={on} onChange={() => (on ? disable() : void enable())} />
            <span />
          </span>
        )}
      </label>
      {kept && (
        <div className="ai-settings-body">
          <button className="link small ai-wipe" onClick={() => void wipe()} disabled={busy}>
            KI-Daten von diesem Gerät löschen ({mb(bytes!)})
          </button>
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
          <ModelChoice accounts={accounts} />
          <LearnedNames />
          <button className="link small ai-wipe" onClick={() => void wipe()} disabled={busy}>
            KI-Daten von diesem Gerät löschen
          </button>
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

/** Abstand zweier Wörter (Tippfehler-Vorschläge für Testordner). */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Haben zwei Wörter 4 Buchstaben am Stück gemeinsam? */
function shares4(a: string, b: string): boolean {
  for (let i = 0; i + 4 <= a.length; i++) if (b.includes(a.slice(i, i + 4))) return true;
  return false;
}

/** Modell wählen: Standard oder MobileCLIP (Test, nur in Testordnern). */
function ModelChoice({ accounts }: { accounts: Account[] }) {
  const model = useAiModel();
  const [comparing, setComparing] = useState(false);
  const folders = useTestFolders();
  const [counts, setCounts] = useState<Map<string, number> | null>(null);
  const [allDirs, setAllDirs] = useState<string[]>([]);
  const [text, setText] = useState("");

  useEffect(() => {
    if (model !== "mobileclip") return;
    let alive = true;
    catalog()
      .then((items) => {
        if (!alive) return;
        const c = new Map<string, number>();
        const dirs = new Set<string>();
        for (const it of items.values()) {
          for (const d of (it.path ?? "").split("/").slice(0, -1)) dirs.add(d);
          for (const f of folders) if (inTestFolders(it.path, [f])) c.set(f, (c.get(f) ?? 0) + 1);
        }
        setCounts(c);
        setAllDirs([...dirs]);
      })
      .catch(() => setCounts(new Map()));
    return () => {
      alive = false;
    };
  }, [model, folders]);

  const suggest = (f: string) => {
    const low = f.toLowerCase();
    return allDirs
      .map((d) => ({ d, n: distance(low, d.toLowerCase()) }))
      // Ähnlich geschrieben, oder 4 Buchstaben am Stück gleich („Underrune“ → „Deltarune“, „Undertale“)
      .filter((x) => x.n <= Math.max(2, Math.floor(low.length / 3)) || shares4(low, x.d.toLowerCase()))
      .sort((a, b) => a.n - b.n)
      .slice(0, 4)
      .map((x) => x.d);
  };
  const add = (name: string) => {
    const n = name.trim();
    setText("");
    if (n && !folders.some((f) => f.toLowerCase() === n.toLowerCase())) setTestFolders([...folders, n]);
  };
  const replace = (from: string, to: string) => setTestFolders(folders.map((f) => (f === from ? to : f)));
  const total = counts ? [...counts.values()].reduce((a, b) => a + b, 0) : null;

  return (
    <div className="ai-names">
      <div className="ai-names-head">
        <strong className="small">Modell</strong>
        <span className="faint small">Jedes Modell hat seinen eigenen Index – Umschalten löscht nichts.</span>
      </div>
      {(["clip", "mobileclip"] as const).map((m) => (
        <label key={m} className="ai-mode-opt">
          <input type="radio" name="ai-model" checked={model === m} onChange={() => setAiModel(m)} />
          <span>
            <strong>{MODELS[m].label}</strong>
            <small className="faint">
              {m === "clip"
                ? "OpenAI CLIP (2021) – lernt alle Fotos"
                : "Apple MobileCLIP (2024) – kleiner, laut Apple treffsicherer. Zum Testen: lernt nur Fotos in den Testordnern (einmalig ca. 200 MB laden)"}
            </small>
          </span>
        </label>
      ))}
      {model === "mobileclip" && (
        <>
          <div className="faint small">
            Testordner{total !== null && ` · ${total.toLocaleString("de-CH")} Fotos`} – Suche findet mit diesem Modell nur Fotos darin.
          </div>
          <div className="ai-name-chips">
            {folders.map((f) => {
              const n = counts?.get(f) ?? 0;
              const tips = counts && n === 0 ? suggest(f) : [];
              return (
                <span key={f} className="ai-folder-chip">
                  <span className={`ai-name-chip on ${counts && !n ? "missing" : ""}`}>
                    <Icon name="folder" size={12} /> {f} <span className="faint">{counts ? n : "…"}</span>
                    <button onClick={() => setTestFolders(folders.filter((x) => x !== f))} aria-label={`${f} entfernen`}>
                      <Icon name="x" size={12} />
                    </button>
                  </span>
                  {counts && !n && (
                    <span className="faint small">
                      Nicht gefunden
                      {tips.length > 0 && " – meintest du "}
                      {tips.map((t, i) => (
                        <span key={t}>
                          {i > 0 && ", "}
                          <button className="link small" onClick={() => replace(f, t)}>
                            {t}
                          </button>
                        </span>
                      ))}
                      {tips.length > 0 && "?"}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
          <form
            className="ai-name-form"
            onSubmit={(e) => {
              e.preventDefault();
              add(text);
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ordnername hinzufügen" enterKeyHint="done" autoCorrect="off" />
            <button className="btn small primary" disabled={!text.trim()}>
              Hinzufügen
            </button>
          </form>
        </>
      )}
      <button className="btn small" onClick={() => setComparing(true)}>
        <Icon name="search" size={16} /> Modelle vergleichen
      </button>
      <span className="faint small">
        Gleiche Suche mit beiden Modellen nebeneinander (nur Testordner). MobileCLIP lernt nur, solange es oben gewählt ist.
      </span>
      {comparing && (
        <Suspense fallback={null}>
          <CompareSheet accounts={accounts} onClose={() => setComparing(false)} />
        </Suspense>
      )}
    </div>
  );
}
