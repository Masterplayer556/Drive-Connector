// KI-SUCHE (Test): Vergleich – dieselbe Suche mit beiden Modellen nebeneinander, über alle Fotos.
// Ohne 👍/👎, Namen und Tags (reiner Modellvergleich). Strichliste: welches Modell war besser?
import "./ai.css";
import { createPortal } from "react-dom";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";
import Thumb from "../components/Thumb";
import type { Account, Item } from "../lib/types";
import { addToTally, compareTally, resetTally, type Tally } from "./flag";
import { searchClosed, searchOpened } from "./indexer";
import { isModelId, MODEL_IDS, MODELS } from "./protocol";
import { compareModels, type CompareId, type CompareSide } from "./search";

const CHOICES: CompareId[] = [...MODEL_IDS, "kombi"];
const labelOf = (id: CompareId) => (id === "kombi" ? "Kombi (B + Standard)" : MODELS[id].label);
const isChoice = (x: unknown): x is CompareId => x === "kombi" || isModelId(x);

const Viewer = lazy(() => import("../components/Viewer"));

type Result = { query: string; pair: string; english: string; left: CompareSide; right: CompareSide };

const PAIR_KEY = "drivepool.ai.comparePair";
function loadPair(): [CompareId, CompareId] {
  try {
    const [a, b] = JSON.parse(localStorage.getItem(PAIR_KEY) ?? "[]");
    if (isChoice(a) && isChoice(b) && a !== b) return [a, b];
  } catch {
    /* ignorieren */
  }
  return ["clip", "mobileclip"];
}

export default function CompareSheet({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [[left, right], setPair] = useState<[CompareId, CompareId]>(loadPair);
  const pair = `${left}|${right}`;
  const [tally, setTally] = useState<Tally>(() => compareTally(left, right));
  useEffect(() => {
    setTally(compareTally(left, right));
    try {
      localStorage.setItem(PAIR_KEY, JSON.stringify([left, right]));
    } catch {
      /* ignorieren */
    }
  }, [left, right]);
  const choose = (side: 0 | 1, m: CompareId) =>
    setPair(([a, b]) => (side === 0 ? (m === b ? [m, a] : [m, b]) : m === a ? [b, m] : [a, m]));
  const [voted, setVoted] = useState<Set<string>>(new Set());
  const [viewer, setViewer] = useState<{ items: Item[]; index: number } | null>(null);
  const seq = useRef(0);

  // Während des Vergleichs pausiert das Lernen (Speicher für die Suchmodelle)
  useEffect(() => {
    searchOpened();
    return searchClosed;
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) return setResult(null);
    const n = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      compareModels(term, left, right)
        .then((r) => n === seq.current && (setResult({ query: term, pair, ...r }), setError(null)))
        .catch((e) => n === seq.current && setError(e instanceof Error ? e.message : String(e)))
        .finally(() => n === seq.current && setBusy(false));
    }, 650);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, pair]);

  const voteKey = result ? `${result.pair}|${result.query.toLowerCase()}` : "";
  const vote = (w: keyof Tally) => {
    if (!result || result.pair !== pair || voted.has(voteKey)) return;
    setTally(addToTally(left, right, w));
    setVoted((v) => new Set(v).add(voteKey));
  };
  const total = tally.left + tally.right + tally.same;
  const hasVoted = !!result && voted.has(voteKey);

  const column = (side: CompareSide, label: string) => (
    <div className="cmp-col">
      <div className="cmp-head">
        <strong className="small">{label}</strong>
        <span className="faint small">{side.learned.toLocaleString("de-CH")} gelernt</span>
      </div>
      {side.learned === 0 ? (
        <p className="muted small">Noch nichts gelernt.</p>
      ) : side.items.length === 0 ? (
        <p className="muted small">Kein Treffer.</p>
      ) : (
        <div className="cmp-grid">
          {side.items.map((f, i) => (
            <button key={`${f.account_id}|${f.drive_id}`} className="cell" onClick={() => setViewer({ items: side.items, index: i })}>
              <Thumb item={f} />
              <span className="cmp-rank">{i + 1}</span>
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
      <div className="sheet search-sheet">
        <div className="sheet-grip" />
        <div className="search-bar">
          <div className="search-field glass">
            <Icon name="search" size={18} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suche für beide Modelle" enterKeyHint="search" autoCapitalize="off" autoCorrect="off" autoFocus />
            {busy && <span className="spinner" style={{ width: 16, height: 16 }} />}
          </div>
          <button className="btn ghost small" onClick={onClose}>
            Fertig
          </button>
        </div>
        <div className="sheet-body">
          <div className="cmp-pick">
            {([0, 1] as const).map((side) => (
              <select key={side} value={side === 0 ? left : right} onChange={(e) => choose(side, e.target.value as CompareId)} aria-label={side === 0 ? "Links" : "Rechts"}>
                {CHOICES.map((m) => (
                  <option key={m} value={m}>
                    {labelOf(m)}
                  </option>
                ))}
              </select>
            ))}
          </div>
          <p className="faint small" style={{ margin: 0 }}>
            Alle Fotos, die das jeweilige Modell gelernt hat · ohne 👍/👎, Namen und Tags – reiner Modellvergleich.
            {total > 0 && (
              <>
                <br />
                Bisher besser: {labelOf(left)} <b>{tally.left}</b> · {labelOf(right)} <b>{tally.right}</b> · gleich{" "}
                {tally.same}{" "}
                <button className="link small" onClick={() => (resetTally(left, right), setTally(compareTally(left, right)))}>
                  zurücksetzen
                </button>
              </>
            )}
          </p>
          {error && <p className="muted small">Nicht möglich: {error}</p>}
          {!result && !busy && (
            <p className="muted small" style={{ textAlign: "center", marginTop: 20 }}>
              Gib eine Suche ein, z. B. „Link with sword“, „Mario jumping“ oder „castle“.
            </p>
          )}
          {result && (
            <>
              <p className="faint small ai-understood">Verstanden als „{result.english}“</p>
              <div className="cmp-cols">
                {column(result.left, labelOf(left))}
                {column(result.right, labelOf(right))}
              </div>
              <div className="cmp-vote">
                {hasVoted ? (
                  <span className="muted small">Danke – notiert. Nächste Suche eingeben.</span>
                ) : (
                  <>
                    <button className="btn small" onClick={() => vote("left")}>
                      ◀ Links besser
                    </button>
                    <button className="btn small ghost" onClick={() => vote("same")}>
                      Gleich
                    </button>
                    <button className="btn small" onClick={() => vote("right")}>
                      Rechts besser ▶
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {viewer && (
        <div className="ai-similar-viewer">
          <Suspense fallback={null}>
            <Viewer
              items={viewer.items}
              index={viewer.index}
              accounts={accounts}
              onIndex={(i) => setViewer((v) => (v ? { ...v, index: i } : v))}
              onClose={() => setViewer(null)}
            />
          </Suspense>
        </div>
      )}
    </>,
    document.body,
  );
}
