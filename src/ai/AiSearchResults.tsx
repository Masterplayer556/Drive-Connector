// KI-SUCHE (Test): zusätzlicher Abschnitt „Passt zur Beschreibung“ im Suchfenster.
import "./ai.css";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";
import Thumb from "../components/Thumb";
import { TagDots } from "../components/TagSheet";
import { SelectCheck, SelectionBar, SelectToggle, useSelection } from "../components/Selection";
import { useTags } from "../lib/tags";
import type { Account, Item } from "../lib/types";
import { modelProgress, onModelProgress } from "./engine";
import { indexState, searchClosed, searchOpened } from "./indexer";
import { aiSearch, privateAccounts, vote, type AiResult } from "./search";
import { itemKey } from "./store";
import { nameRuns } from "./dict";
import { parseQuery } from "./query";
import { useFeedbackEnabled } from "./flag";

const Viewer = lazy(() => import("../components/Viewer"));
const TrainSheet = lazy(() => import("./TrainSheet"));

export default function AiSearchResults({
  query,
  accounts,
  includePrivate = false,
}: {
  query: string;
  accounts: Account[];
  /** Fotos aus privaten Konten zeigen? (Standard: nein) */
  includePrivate?: boolean;
}) {
  const [result, setResult] = useState<AiResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const [votes, setVotes] = useState<Map<string, 1 | -1>>(new Map());
  const feedbackOn = useFeedbackEnabled();
  const [training, setTraining] = useState(false);
  const sel = useSelection();
  useTags();
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
      aiSearch(term, { exclude: includePrivate ? undefined : privateAccounts(accounts) })
        .then((r) => n === seq.current && (setResult(r), setVotes(new Map(r.votes)), setError(null)))
        .catch((e) => n === seq.current && setError(e instanceof Error ? e.message : String(e)))
        .finally(() => n === seq.current && setBusy(false));
    }, 550);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, includePrivate]);

  if (query.trim().length < 3) return null;

  const items = result?.items ?? [];
  const p = modelProgress("text");
  const downloading = busy && p && p.total > 0 && p.loaded < p.total;
  const idx = indexState();
  const unknownNames = nameRuns(parseQuery(query).text).map((r) => r.label);

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
        <span className="row" style={{ gap: 10 }}>
          {items.length > 0 && !busy && <SelectToggle sel={sel} />}
          {busy ? <span className="spinner" style={{ width: 14, height: 14 }} /> : items.length}
        </span>
      </div>

      {downloading && (
        <p className="muted small">
          Suchmodell wird einmalig geladen … {Math.round((p.loaded / p.total) * 100)} %
        </p>
      )}
      {error && <p className="muted small">KI-Suche nicht möglich: {error}</p>}
      {result && !busy && (result.folder || result.video || result.tag) && (
        <div className="ai-filters">
          {result.tag && (
            <span className="ai-filter">
              <Icon name="tag" size={12} /> {result.tag}
            </span>
          )}
          {result.folder && (
            <span className="ai-filter">
              <Icon name="folder" size={12} /> {result.folder}
            </span>
          )}
          {result.video && (
            <span className="ai-filter">
              <Icon name="play" size={12} /> Nur Videos
            </span>
          )}
        </div>
      )}
      {result && !busy && result.tagHelp.length > 0 && (
        <div className="ai-filters">
          {result.tagHelp.map((t) => (
            <span key={t.label} className="ai-filter">
              <Icon name="tag" size={12} /> {t.label} · {t.count} {t.count === 1 ? "Foto hilft" : "Fotos helfen"} der KI
            </span>
          ))}
        </div>
      )}
      {result && !busy && result.names.length > 0 && (
        <div className="ai-filters">
          {result.names.map((n) => (
            <span key={n.label} className="ai-filter">
              <Icon name="user" size={12} /> {n.label} · {n.count} {n.count === 1 ? "Foto" : "Fotos"} gelernt
            </span>
          ))}
        </div>
      )}
      {result && !busy && !result.filterOnly && result.names.length === 0 && unknownNames.length > 0 && (
        <p className="faint small ai-understood">
          Falls {unknownNames.map((n) => `„${n}“`).join(", ")} ein Name ist: Namen lernt die KI, wenn du passenden Fotos 👍 gibst
          oder sie in der Foto-Ansicht (✨ → „Wer ist das?“) benennst. Danach findet die Suche ähnlich aussehende Fotos.
        </p>
      )}
      {result && !busy &&
        (result.filterOnly ? (
          <p className="faint small ai-understood">
            {result.indexed.toLocaleString("de-CH")} {result.video ? "Videos" : "Fotos und Videos"}
            {result.folder && ` in Ordnern mit „${result.folder}“`}
            {result.tag && ` mit #${result.tag}`} · neueste zuerst
            {result.indexed > items.length && ` (die ersten ${items.length})`}
          </p>
        ) : (
          <p className="faint small ai-understood">
            {result.indexed.toLocaleString("de-CH")} {result.video ? "Videos" : "Fotos"} durchsucht
            {!result.folder && !result.video && !result.tag && idx.total > result.indexed && ` (von ${idx.total.toLocaleString("de-CH")})`}
          </p>
        ))}
      {result && !busy && items.length === 0 && (
        <p className="muted small">
          {result.indexed === 0 && result.tag
            ? `Keine Fotos mit #${result.tag}${result.filterOnly ? "" : " gelernt"}.`
            : result.indexed === 0 && result.folder
            ? `Kein Ordner mit „${result.folder}“ gefunden (oder darin ist noch nichts gelernt).`
            : result.video && result.indexed === 0
              ? "Noch keine Videos gelernt."
              : "Nichts passt gut genug."}
        </p>
      )}
      {feedbackOn && result && !busy && !result.filterOnly && items.length > 0 && (
        <p className="faint small ai-understood">
          👍 passt · 👎 passt nicht – die Suche lernt daraus, auch für ähnliche Suchen.{" "}
          <button className="link small" onClick={() => setTraining(true)}>
            Schneller trainieren
          </button>
        </p>
      )}
      {training && (
        <Suspense fallback={null}>
          <TrainSheet accounts={accounts} start={parseQuery(query).text || query} onClose={() => setTraining(false)} />
        </Suspense>
      )}

      {items.length > 0 && (
        <div className="grid stagger">
          {items.map((f, i) => {
            const showVotes = feedbackOn && !result?.filterOnly && !sel.on;
            const v = showVotes ? votes.get(itemKey(f)) : undefined;
            return (
              <div key={`${f.account_id}|${f.drive_id}`} className={`ai-cell ${v === -1 ? "down" : v === 1 ? "up" : ""}`} style={{ ["--i" as string]: i }}>
                <button className={`cell ${sel.has(f) ? "selected" : ""}`} onClick={() => (sel.on ? sel.toggle(f) : setViewer(i))}>
                  <Thumb item={f} />
                  <TagDots item={f} />
                  <SelectCheck sel={sel} item={f} />
                  <span className="cell-name">{f.name}</span>
                  {f.mime_type?.startsWith("video/") && (
                    <span className="cell-play">
                      <Icon name="play" size={14} />
                    </span>
                  )}
                </button>
                {showVotes && (
                  <span className="ai-votes">
                    <button className={v === 1 ? "on" : ""} onClick={() => rate(f, 1)} aria-label="Passt">
                      👍
                    </button>
                    <button className={v === -1 ? "on" : ""} onClick={() => rate(f, -1)} aria-label="Passt nicht">
                      👎
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <SelectionBar sel={sel} items={items} />

      {viewer !== null && items[viewer] && (
        <Suspense fallback={null}>
          <Viewer items={items as Item[]} index={viewer} accounts={accounts} onIndex={setViewer} onClose={() => setViewer(null)} />
        </Suspense>
      )}
    </div>
  );
}
