// KI-SUCHE (Test): zusätzlicher Abschnitt „Passt zur Beschreibung“ im Suchfenster.
import "./ai.css";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";
import Thumb from "../components/Thumb";
import type { Account, Item } from "../lib/types";
import { modelProgress, onModelProgress } from "./engine";
import { indexState, searchClosed, searchOpened } from "./indexer";
import { aiSearch, vote, type AiResult } from "./search";
import { itemKey } from "./store";

const Viewer = lazy(() => import("../components/Viewer"));

export default function AiSearchResults({ query, accounts }: { query: string; accounts: Account[] }) {
  const [result, setResult] = useState<AiResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const [votes, setVotes] = useState<Map<string, 1 | -1>>(new Map());
  const [, tick] = useState(0);
  const seq = useRef(0);

  useEffect(() => onModelProgress(() => tick((n) => n + 1)), []);
  // Während das Suchfenster offen ist, pausiert das Lernen (Arbeitsspeicher für die Suche)
  useEffect(() => {
    searchOpened();
    return searchClosed;
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 3) {
      setResult(null);
      setError(null);
      setBusy(false);
      return;
    }
    const n = ++seq.current;
    setBusy(true);
    // Etwas länger warten als die Namenssuche: erst wenn du kurz nicht mehr tippst
    const t = setTimeout(() => {
      aiSearch(term)
        .then((r) => n === seq.current && (setResult(r), setVotes(new Map(r.votes)), setError(null)))
        .catch((e) => n === seq.current && setError(e instanceof Error ? e.message : String(e)))
        .finally(() => n === seq.current && setBusy(false));
    }, 550);
    return () => clearTimeout(t);
  }, [query]);

  if (query.trim().length < 3) return null;

  const items = result?.items ?? [];
  const p = modelProgress("text");
  const downloading = busy && p && p.total > 0 && p.loaded < p.total;
  const idx = indexState();

  /** 👍/👎 – nochmals tippen nimmt es zurück. Gilt ab der nächsten Suche (auch für ähnliche Suchen). */
  const rate = (f: Item, value: 1 | -1) => {
    if (!result) return;
    const k = itemKey(f);
    const next = votes.get(k) === value ? null : value;
    setVotes((m) => {
      const c = new Map(m);
      if (next === null) c.delete(k);
      else c.set(k, next);
      return c;
    });
    void vote(result, f, next).catch(() => undefined);
  };

  return (
    <div className="ai-results">
      <div className="section-title" style={{ padding: "4px 0" }}>
        <span>
          <Icon name="sparkles" size={14} /> Passt zur Beschreibung
        </span>
        <span>{busy ? <span className="spinner" style={{ width: 14, height: 14 }} /> : items.length}</span>
      </div>

      {downloading && (
        <p className="muted small">
          Suchmodell wird einmalig geladen … {Math.round((p.loaded / p.total) * 100)} %
        </p>
      )}
      {error && <p className="muted small">KI-Suche nicht möglich: {error}</p>}
      {result && !busy && (
        <p className="faint small ai-understood">
          Verstanden als „{result.english}“ · {result.indexed.toLocaleString("de-CH")} Fotos durchsucht
          {idx.total > result.indexed && ` (von ${idx.total.toLocaleString("de-CH")})`}
        </p>
      )}
      {result && !busy && items.length === 0 && <p className="muted small">Kein Foto passt gut genug.</p>}
      {result && !busy && items.length > 0 && (
        <p className="faint small ai-understood">👍 passt · 👎 passt nicht – die Suche lernt daraus, auch für ähnliche Suchen.</p>
      )}

      {items.length > 0 && (
        <div className="grid stagger">
          {items.map((f, i) => {
            const v = votes.get(itemKey(f));
            return (
              <div key={`${f.account_id}|${f.drive_id}`} className={`ai-cell ${v === -1 ? "down" : v === 1 ? "up" : ""}`} style={{ ["--i" as string]: i }}>
                <button className="cell" onClick={() => setViewer(i)}>
                  <Thumb item={f} />
                  <span className="cell-name">{f.name}</span>
                  {f.mime_type?.startsWith("video/") && (
                    <span className="cell-play">
                      <Icon name="play" size={14} />
                    </span>
                  )}
                </button>
                <span className="ai-votes">
                  <button className={v === 1 ? "on" : ""} onClick={() => rate(f, 1)} aria-label="Passt">
                    👍
                  </button>
                  <button className={v === -1 ? "on" : ""} onClick={() => rate(f, -1)} aria-label="Passt nicht">
                    👎
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {viewer !== null && items[viewer] && (
        <Suspense fallback={null}>
          <Viewer items={items as Item[]} index={viewer} accounts={accounts} onIndex={setViewer} onClose={() => setViewer(null)} />
        </Suspense>
      )}
    </div>
  );
}
