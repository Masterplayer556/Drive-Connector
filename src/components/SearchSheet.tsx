import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { searchItems } from "../lib/db";
import { hueOf } from "../lib/folderColors";
import type { Account, Item } from "../lib/types";
import Icon from "./Icon";
import Thumb from "./Thumb";
import { useAiEnabled } from "../ai/flag"; // KI-SUCHE

const Viewer = lazy(() => import("./Viewer"));
const AiSearchResults = lazy(() => import("../ai/AiSearchResults")); // KI-SUCHE

/** Suche über alle Konten (#8): Ordner und Fotos nach Name oder Pfad. */
export default function SearchSheet({
  accounts,
  onOpenPath,
  onClose,
}: {
  accounts: Account[];
  onOpenPath: (path: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const ai = useAiEnabled(); // KI-SUCHE

  useEffect(() => {
    setTimeout(() => input.current?.focus(), 150);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    const n = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      searchItems(term)
        .then((r) => n === seq.current && setResults(r))
        .catch(() => n === seq.current && setResults([]))
        .finally(() => n === seq.current && setBusy(false));
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  // Ordner aus mehreren Konten zusammenführen
  const folders = [...new Map((results ?? []).filter((r) => r.is_folder).map((r) => [(r.path ?? "").toLowerCase(), r])).values()];
  const files = (results ?? []).filter((r) => !r.is_folder);

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet search-sheet">
        <div className="sheet-grip" />
        <div className="search-bar">
          <div className="search-field glass">
            <Icon name="search" size={18} />
            <input
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={ai ? "Suchen oder Foto beschreiben" : "Fotos und Ordner suchen"} // KI-SUCHE
              enterKeyHint="search"
              autoCapitalize="off"
              autoCorrect="off"
            />
            {busy && <span className="spinner" style={{ width: 16, height: 16 }} />}
          </div>
          <button className="btn ghost small" onClick={onClose}>
            Fertig
          </button>
        </div>
        <div className="sheet-body">
          {results === null ? (
            <p className="muted small" style={{ textAlign: "center", marginTop: 24 }}>
              {/* KI-SUCHE */ ai ? "Name oder Beschreibung – z. B. „Mathe“, „2024“ oder „Hund im Schnee“." : "Mindestens 2 Zeichen – z. B. „Mathe“, „2024“ oder „IMG_45“."}
            </p>
          ) : results.length === 0 && ai ? null /* KI-SUCHE: „Nichts gefunden“ zeigt dann der KI-Abschnitt */ : results.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">
                <Icon name="search" size={30} />
              </div>
              <strong>Nichts gefunden</strong>
            </div>
          ) : (
            <>
              {folders.length > 0 && (
                <>
                  <div className="section-title" style={{ padding: "4px 0" }}>
                    <span>Ordner</span>
                    <span>{folders.length}</span>
                  </div>
                  <div className="stack" style={{ gap: 8 }}>
                    {folders.slice(0, 20).map((f) => (
                      <button
                        key={f.path}
                        className="folder"
                        style={{ ["--h" as string]: hueOf((f.path ?? "").toLowerCase(), f.name) }}
                        onClick={() => {
                          onOpenPath(f.path!);
                          onClose();
                        }}
                      >
                        <span className="folder-icon">
                          <Icon name="folder" size={18} />
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <div className="folder-name">{f.name}</div>
                          <div className="folder-meta ellipsis">{f.path}</div>
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {files.length > 0 && (
                <>
                  <div className="section-title" style={{ padding: "4px 0" }}>
                    <span>Fotos</span>
                    <span>{files.length}</span>
                  </div>
                  <div className="grid stagger">
                    {files.map((f, i) => (
                      <button key={`${f.account_id}|${f.drive_id}`} className="cell" style={{ ["--i" as string]: i }} onClick={() => setViewer(i)}>
                        <Thumb item={f} />
                        <span className="cell-name">{f.name}</span>
                          {f.mime_type?.startsWith("video/") && (
                            <span className="cell-play">
                              <Icon name="play" size={14} />
                            </span>
                          )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          {/* KI-SUCHE */}
          {ai && (
            <Suspense fallback={null}>
              <AiSearchResults query={q} accounts={accounts} />
            </Suspense>
          )}
        </div>
      </div>
      {viewer !== null && files[viewer] && (
        <Suspense fallback={null}>
          <Viewer items={files} index={viewer} accounts={accounts} onIndex={setViewer} onClose={() => setViewer(null)} />
        </Suspense>
      )}
    </>
  );
}
