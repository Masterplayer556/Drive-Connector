// KI-SUCHE (Test): „KI trainieren“ – ein Begriff (vorgeschlagen oder selbst eingegeben) und ein Foto: nach
// rechts wischen = passt, nach links = passt nicht. Läuft endlos weiter (Paket für Paket), bis „Fertig“ oder
// ein anderer Begriff. Jede Antwort ist ein 👍/👎 für diesen Begriff (gleich wie in der Suche).
import "./ai.css";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";
import { haptic } from "../lib/haptic";
import { getThumb } from "../lib/thumbs";
import type { Account, Item } from "../lib/types";
import { searchClosed, searchOpened } from "./indexer";
import { itemKey } from "./store";
import { privateAccounts, trainingBatch, trainingTerms, vote, type TrainingBatch } from "./search";
import type { Term } from "./train";

const CARD_SIZE = 800;
const SWIPE = 90; // ab so vielen Pixeln zählt das Wischen

const SOURCE: Record<Term["source"], string> = { foto: "Oft auf deinen Fotos", name: "Gelernter Name", suche: "Deine Suche" };

export default function TrainSheet({ accounts, start, onClose }: { accounts: Account[]; start?: string; onClose: () => void }) {
  const [terms, setTerms] = useState<Term[] | null>(null);
  const [ti, setTi] = useState(0);
  const [batch, setBatch] = useState<TrainingBatch | null | undefined>(undefined); // undefined = lädt, null = keine mehr
  const [ci, setCi] = useState(0);
  const [done, setDone] = useState({ yes: 0, no: 0 });
  const [termCount, setTermCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [text, setText] = useState("");
  const skipped = useRef(0);
  // Selbst gewählter Begriff: nicht automatisch weiterspringen, wenn er nichts findet
  const manual = useRef(!!start);
  // Fotos, die zu diesem Begriff schon gezeigt wurden (auch „weiss nicht“) und das schon geladene nächste Paket
  const seen = useRef(new Set<string>());
  const pending = useRef<Promise<TrainingBatch | null> | null>(null);

  // Während des Trainierens pausiert das Lernen (Speicher fürs Suchmodell)
  useEffect(() => {
    searchOpened();
    return searchClosed;
  }, []);

  useEffect(() => {
    trainingTerms(setPreparing)
      .then((t) => setTerms(start ? [{ label: start, source: "suche" as const }, ...t.filter((x) => x.label.toLowerCase() !== start.toLowerCase())] : t))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [start]);

  const exclude = privateAccounts(accounts);
  const load = (label: string) => {
    const s = seen.current;
    return trainingBatch(label, { exclude, skip: s }).then((b) => {
      b?.items.forEach((it) => s.add(itemKey(it)));
      return b;
    });
  };

  // Neuer Begriff → von vorne
  const term = terms?.[ti];
  useEffect(() => {
    if (!term) return;
    let alive = true;
    seen.current = new Set();
    pending.current = null;
    setBatch(undefined);
    setCi(0);
    setTermCount(0);
    load(term.label)
      .then((b) => {
        if (!alive) return;
        // Vorgeschlagener Begriff ohne passende Fotos → gleich weiter (höchstens ein paar Mal hintereinander)
        if (!b && !manual.current && skipped.current < 5 && terms && ti < terms.length - 1) {
          skipped.current++;
          setTi((i) => i + 1);
          return;
        }
        skipped.current = 0;
        setBatch(b);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term?.label]);

  // Endlos: kurz vor dem Ende schon das nächste Paket holen, am Ende nahtlos weiter
  useEffect(() => {
    if (!batch || !term) return;
    if (ci >= batch.items.length - 3 && !pending.current) pending.current = load(term.label);
    if (ci < batch.items.length || !pending.current) return;
    let alive = true;
    pending.current
      .then((b) => {
        if (!alive) return;
        pending.current = null;
        setBatch(b);
        setCi(0);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ci, batch]);

  const next = () => {
    manual.current = false;
    setPicking(false);
    setTi((i) => (terms && terms.length ? (i + 1) % terms.length : 0));
  };
  /** Begriff selbst wählen (aus der Liste oder eingetippt). */
  const choose = (label: string) => {
    const l = label.trim();
    if (!l || !terms) return;
    manual.current = true;
    skipped.current = 0;
    setPicking(false);
    setText("");
    const i = terms.findIndex((t) => t.label.toLowerCase() === l.toLowerCase());
    if (i >= 0) return setTi(i);
    const at = terms.length ? ti + 1 : 0;
    setTerms([...terms.slice(0, at), { label: l, source: "suche" }, ...terms.slice(at)]);
    setTi(at);
  };

  const card = batch?.items[ci];
  const answer = (value: 1 | -1 | null) => {
    if (!batch || !card) return;
    if (value) {
      void vote(batch, card, value).catch(() => undefined);
      setDone((d) => (value > 0 ? { ...d, yes: d.yes + 1 } : { ...d, no: d.no + 1 }));
      setTermCount((c) => c + 1);
    }
    setCi((i) => i + 1);
  };

  const picker = terms && (
    <div className="train-picker">
      <form
        className="ai-name-form"
        onSubmit={(e) => {
          e.preventDefault();
          choose(text);
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Begriff eingeben, z. B. Hund"
          enterKeyHint="go"
          autoCorrect="off"
          autoFocus={picking}
        />
        <button className="btn small primary" disabled={!text.trim()}>
          Los
        </button>
      </form>
      {picking && terms.length > 0 && (
        <div className="train-chips">
          {terms.map((t, i) => (
            <button key={t.label} className={`chip ${i === ti ? "on" : ""}`} onClick={() => choose(t.label)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // Direkt an die Seite hängen: im Einstellungs-Kasten (Glas-Effekt) würde das Fenster sonst eingesperrt
  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet train-sheet">
        <div className="sheet-grip" />
        <div className="search-bar">
          <strong className="ai-similar-title">
            <Icon name="sparkles" size={16} /> KI trainieren
          </strong>
          <button className="btn ghost small" onClick={onClose}>
            Fertig
          </button>
        </div>
        <div className="sheet-body train-body">
          {error ? (
            <p className="muted small">Nicht möglich: {error}</p>
          ) : !terms ? (
            <div className="train-card train-placeholder">
              <div className="spinner" />
              <p className="muted small">{preparing ?? "Schaue, was oft auf deinen Fotos ist …"}</p>
            </div>
          ) : !terms.length ? (
            <>
              <p className="muted small">Noch keine Vorschläge – die KI muss zuerst mehr Fotos lernen. Du kannst aber selbst einen Begriff eingeben:</p>
              {picker}
            </>
          ) : (
            <>
              <div className="train-term">
                <span className="faint small">
                  {term ? SOURCE[term.source] : ""} · {termCount} zu diesem Begriff · {done.yes + done.no} total
                </span>
                <h2>Passt „{term?.label}“?</h2>
                {term?.note && term.source === "foto" && <span className="muted small">{term.note}</span>}
                <div className="row" style={{ gap: 12, justifyContent: "center" }}>
                  <button className="link small" onClick={() => setPicking((p) => !p)}>
                    {picking ? "Schliessen" : "Begriff wählen"}
                  </button>
                  <button className="link small" onClick={next}>
                    Nächster Vorschlag
                  </button>
                </div>
              </div>
              {picking && picker}

              {batch === undefined || (batch && !card) ? (
                <div className="train-card train-placeholder">
                  <div className="spinner" />
                  {batch && <p className="muted small">Weitere Fotos laden …</p>}
                </div>
              ) : batch === null || !card ? (
                <div className="train-card train-placeholder">
                  <p className="muted small">
                    {termCount
                      ? `„${term?.label}“: ${termCount} Fotos bewertet – keine weiteren passenden Fotos mehr.`
                      : `Zu „${term?.label}“ gibt es nichts (mehr) zu trainieren.`}
                  </p>
                  <div className="row" style={{ gap: 8, justifyContent: "center" }}>
                    <button className="btn small" onClick={() => setPicking(true)}>
                      Begriff wählen
                    </button>
                    <button className="btn small primary" onClick={next}>
                      Nächster Vorschlag
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <SwipeCard key={`${card.account_id}|${card.drive_id}`} item={card} next={batch.items[ci + 1]} onAnswer={answer} />
                  <div className="train-buttons">
                    <button className="train-btn no" onClick={() => answer(-1)} aria-label="Passt nicht">
                      <Icon name="x" size={26} />
                    </button>
                    <button className="train-btn skip" onClick={() => answer(null)} aria-label="Weiss nicht">
                      ?
                    </button>
                    <button className="train-btn yes" onClick={() => answer(1)} aria-label="Passt">
                      <Icon name="check" size={26} />
                    </button>
                  </div>
                  <p className="faint small train-hint">
                    → rechts wischen = passt · ← links = passt nicht · ? = weiss nicht · läuft weiter, bis du „Fertig“ drückst
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

/** Ein Foto zum Wischen. */
export function SwipeCard({ item, next, onAnswer }: { item: Item; next?: Item; onAnswer: (v: 1 | -1) => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [dx, setDx] = useState(0);
  const [out, setOut] = useState<1 | -1 | null>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);

  useEffect(() => {
    let alive = true;
    getThumb(item, CARD_SIZE)
      .then((u) => alive && setSrc(u))
      .catch(() => undefined);
    // Nächstes Foto schon laden
    if (next) void getThumb(next, CARD_SIZE).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [item, next]);

  const finish = (v: 1 | -1) => {
    haptic();
    setOut(v);
    setTimeout(() => onAnswer(v), 180);
  };

  return (
    <div
      className={`train-card ${out ? "gone" : ""}`}
      style={{
        transform: out ? `translateX(${out * 130}%) rotate(${out * 18}deg)` : `translateX(${dx}px) rotate(${dx / 18}deg)`,
        transition: start.current && !out ? "none" : undefined,
      }}
      onPointerDown={(e) => {
        if (out) return;
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (start.current?.id === e.pointerId) setDx(e.clientX - start.current.x);
      }}
      onPointerUp={() => {
        if (!start.current) return;
        start.current = null;
        if (dx > SWIPE) finish(1);
        else if (dx < -SWIPE) finish(-1);
        else setDx(0);
      }}
      onPointerCancel={() => {
        start.current = null;
        setDx(0);
      }}
    >
      {src ? <img src={src} alt="" draggable={false} /> : <div className="spinner" />}
      {item.mime_type?.startsWith("video/") && (
        <span className="cell-play">
          <Icon name="play" size={14} />
        </span>
      )}
      <span className="train-stamp yes" style={{ opacity: Math.max(0, Math.min(1, dx / SWIPE)) }}>
        PASST
      </span>
      <span className="train-stamp no" style={{ opacity: Math.max(0, Math.min(1, -dx / SWIPE)) }}>
        PASST NICHT
      </span>
    </div>
  );
}
