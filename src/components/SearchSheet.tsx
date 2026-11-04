import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { searchItems } from "../lib/db";
import { allTags, taggedItems, useTags } from "../lib/tags";
import { TagDots } from "./TagSheet";
import { hueOf } from "../lib/folderColors";
import type { Account, Item } from "../lib/types";
import Icon from "./Icon";
import Thumb from "./Thumb";
import { useAiEnabled } from "../ai/flag"; // KI-SUCHE
import SearchModeMenu, { useSearchMode } from "../ai/SearchModeMenu"; // KI-SUCHE

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
  const [mode, setMode] = useSearchMode(); // KI-SUCHE: mit KI oder nach Namen
  const [includePrivate, setIncludePrivate] = useState(false); // KI-SUCHE: private Konten nur auf Wunsch
  const kiMode = ai && mode === "ki"; // KI-SUCHE
  useTags();
  const tags = allTags();
  // „#Ferien“ in der Namenssuche: alle Fotos mit diesem Tag
  const tagQuery = !kiMode && q.trim().startsWith("#") ? q.trim().slice(1).replace(/^["“„«]|["”“»]$/g, "").trim() : null;

  useEffect(() => {
    setTimeout(() => input.current?.focus(), 150);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if ((term.length < 2 && !tagQuery) || kiMode || tagQuery === "") {
      setResults(null);
      setBusy(false);
      return;
    }
    const n = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      (tagQuery ? taggedItems(tagQuery) : searchItems(term))
        .then((r) => n === seq.current && setResults(r))
        .catch(() => n === seq.current && setResults([]))
        .finally(() => n === seq.current && setBusy(false));
    }, 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, kiMode]);

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
              placeholder={kiMode ? "Foto beschreiben" : "Fotos und Ordner suchen"} // KI-SUCHE
              enterKeyHint="search"
              autoCapitalize="off"
              autoCorrect="off"
            />
            {busy && <span className="spinner" style={{ width: 16, height: 16 }} />}
          </div>
          {/* KI-SUCHE */}
          {ai && (
            <SearchModeMenu mode={mode} onMode={setMode} includePrivate={includePrivate} onIncludePrivate={setIncludePrivate} />
          )}
          <button className="btn ghost small" onClick={onClose}>
            Fertig
          </button>
        </div>
        <div className="sheet-body">
          {/* KI-SUCHE: im KI-Modus nur die KI-Treffer */}
          {kiMode ? (
            <>
              {q.trim().length < 3 && (
                <p className="muted small" style={{ textAlign: "center", marginTop: 24 }}>
                  Beschreibe das Foto – z. B. „Hund im Schnee“ oder „Arbeitsblatt mit Tabelle“.
                  {!includePrivate && " Private Fotos sind ausgeblendet."}
                  <br />
                  „O: Ferien Strand“ sucht nur im Ordner „Ferien“, „Video Strand“ nur Videos.
                  Englisch geht auch („dog in the snow“). Eigene Tags: „#Ferien Strand“.
                </p>
              )}
              {q.trim().length < 3 && tags.length > 0 && (
                <TagChips tags={tags} onPick={(t) => setQ(`#${t.includes(" ") ? `"${t}"` : t}`)} />
              )}
              <Suspense fallback={null}>
                <AiSearchResults query={q} accounts={accounts} includePrivate={includePrivate} />
              </Suspense>
            </>
          ) : results === null ? (
            <>
              <p className="muted small" style={{ textAlign: "center", marginTop: 24 }}>
                Mindestens 2 Zeichen – z. B. „Mathe“, „2024“ oder „IMG_45“. Eigene Tags mit „#“, z. B. „#Ferien“.
              </p>
              {tags.length > 0 && <TagChips tags={tags} onPick={(t) => setQ(`#${t.includes(" ") ? `"${t}"` : t}`)} />}
            </>
          ) : results.length === 0 ? (
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
                    <span>{tagQuery ? `#${tagQuery}` : "Fotos"}</span>
                    <span>{files.length}</span>
                  </div>
                  <div className="grid stagger">
                    {files.map((f, i) => (
                      <button key={`${f.account_id}|${f.drive_id}`} className="cell" style={{ ["--i" as string]: i }} onClick={() => setViewer(i)}>
                        <Thumb item={f} />
                        <TagDots item={f} />
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

/** Alle eigenen Tags zum Antippen (Merkzeichen als Farbpunkt). */
function TagChips({ tags, onPick }: { tags: { tag: string; count: number; color: string | null }[]; onPick: (tag: string) => void }) {
  return (
    <div className="tag-chips" style={{ justifyContent: "center", marginTop: 12 }}>
      {tags.map((t) => (
        <button key={t.tag} className="tag-chip" onClick={() => onPick(t.tag)}>
          {t.color ? <i className="tag-chip-dot" style={{ background: t.color }} /> : "#"}
          {t.tag} <span className="faint">{t.count}</span>
        </button>
      ))}
    </div>
  );
}
