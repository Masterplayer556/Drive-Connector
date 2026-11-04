// KI-SUCHE (Test): ✨ für einen Ordner – Ordner mit einem Namen verknüpfen (z. B. ein Ordner pro Figur)
// und passende Fotos finden, die noch woanders liegen (zum Hineinverschieben).
import "./ai.css";
import { lazy, Suspense, useEffect, useState } from "react";
import Icon from "../components/Icon";
import Thumb from "../components/Thumb";
import { childKey, childPath } from "../lib/naming";
import type { Account, Crumb, Item, LogicalFolder } from "../lib/types";
import { allNames, folderNames, linkFolderName, privateAccounts, similarToFolder, unlinkFolderName } from "./search";

const Viewer = lazy(() => import("../components/Viewer"));
const MoveSheet = lazy(() => import("../components/MoveSheet"));

/** Pfad → Brotkrumen bis zum Ordner (für das Verschieben-Fenster). */
function crumbsOf(path: string): Crumb[] {
  const out: Crumb[] = [];
  let key = "";
  let p = "";
  for (const seg of path.split("/")) {
    key = childKey(key, seg);
    p = childPath(p, seg);
    out.push({ name: seg, path: p, key });
  }
  return out;
}

export default function FolderAiSheet({ folder, accounts, onClose }: { folder: LogicalFolder; accounts: Account[]; onClose: () => void }) {
  const [linked, setLinked] = useState<string[] | null>(null);
  const [known, setKnown] = useState<{ label: string; count: number }[]>([]);
  const [text, setText] = useState("");
  const [similar, setSimilar] = useState<{ items: Item[]; learned: number } | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const [moving, setMoving] = useState<Item | null>(null);
  const [moved, setMoved] = useState<Set<string>>(new Set());

  const loadNames = () =>
    Promise.all([folderNames(folder.path), allNames()])
      .then(([l, all]) => {
        setLinked(l);
        setKnown(all);
      })
      .catch(() => setLinked([]));
  useEffect(() => {
    void loadNames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder.path]);

  useEffect(() => {
    setSimilar(undefined);
    // Private Fotos nur, wenn der Ordner selbst privat ist
    const priv = privateAccounts(accounts);
    const isPrivate = folder.parts.length > 0 && folder.parts.every((p) => priv.has(p.account_id));
    similarToFolder(folder.path, { exclude: isPrivate ? undefined : priv })
      .then(setSimilar)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder.path]);

  const has = (n: string) => (linked ?? []).some((l) => l.toLowerCase() === n.toLowerCase());
  const add = async (name: string) => {
    const n = name.trim().replace(/\s+/g, " ");
    setText("");
    if (!n || has(n)) return;
    await linkFolderName(folder.path, n);
    await loadNames();
  };
  const remove = async (name: string) => {
    await unlinkFolderName(folder.path, name);
    await loadNames();
  };

  // Vorschläge: der Ordnername selbst, dann bisherige Namen
  const typed = text.trim().toLowerCase();
  const suggestions = [
    { label: folder.name, count: 0 },
    ...known.filter((k) => k.label.toLowerCase() !== folder.name.toLowerCase()),
  ]
    .filter((k) => !has(k.label) && (!typed || k.label.toLowerCase().startsWith(typed)))
    .slice(0, 8);

  const key = (f: Item) => `${f.account_id}|${f.drive_id}`;
  // Verschobene verschwinden aus der Liste (sie liegen jetzt im Ordner)
  const items = (similar?.items ?? []).filter((f) => !moved.has(key(f)));

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet search-sheet">
        <div className="sheet-grip" />
        <div className="search-bar">
          <strong className="ai-similar-title ellipsis">
            <Icon name="sparkles" size={16} /> {folder.name}
          </strong>
          <button className="btn ghost small" onClick={onClose}>
            Fertig
          </button>
        </div>
        <div className="sheet-body">
          <div className="ai-names">
            <div className="ai-names-head">
              <strong className="small">Wer ist in diesem Ordner?</strong>
              <span className="faint small">
                Ordner mit einem Namen verknüpfen: Die Suche nach dem Namen lernt von allen Fotos darin – auch von später hinzugefügten.
              </span>
            </div>
            {linked && linked.length > 0 && (
              <div className="ai-name-chips">
                {linked.map((m) => (
                  <span key={m} className="ai-name-chip on">
                    {m}
                    <button onClick={() => void remove(m)} aria-label={`${m} entfernen`}>
                      <Icon name="x" size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <form
              className="ai-name-form"
              onSubmit={(e) => {
                e.preventDefault();
                void add(text);
              }}
            >
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Name, z. B. Pikachu" enterKeyHint="done" autoCapitalize="words" autoCorrect="off" />
              <button className="btn small primary" disabled={!text.trim()}>
                Verknüpfen
              </button>
            </form>
            {suggestions.length > 0 && (
              <div className="ai-name-chips">
                {suggestions.map((k) => (
                  <button key={k.label} className="ai-name-chip" onClick={() => void add(k.label)}>
                    + {k.label} {k.count > 0 && <span className="faint">{k.count}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="section-title" style={{ padding: "8px 0 0" }}>
            <span>Passt hierher, liegt aber woanders</span>
            {items.length > 0 && <span>{items.length}</span>}
          </div>
          {error ? (
            <p className="muted small">Nicht möglich: {error}</p>
          ) : similar === undefined ? (
            <div className="spinner" style={{ margin: "24px auto" }} />
          ) : similar === null ? (
            <p className="muted small">In diesem Ordner hat die KI noch nichts gelernt – später nochmals versuchen.</p>
          ) : items.length === 0 ? (
            <p className="muted small">Keine passenden Fotos ausserhalb gefunden ({similar.learned} Fotos im Ordner verglichen).</p>
          ) : (
            <>
              <p className="faint small ai-understood">
                Ähnlich wie die {similar.learned.toLocaleString("de-CH")} gelernten Fotos im Ordner. Antippen zum Ansehen – dort kannst du es
                hierher verschieben.
              </p>
              <div className="grid stagger" style={{ padding: "8px 0" }}>
                {items.map((f, i) => (
                  <button key={key(f)} className="cell" style={{ ["--i" as string]: i }} onClick={() => setViewer(i)}>
                    <Thumb item={f} />
                    <span className="cell-name">{f.path?.split("/").slice(-2, -1)[0] ?? f.name}</span>
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
        </div>
      </div>
      {viewer !== null && items[viewer] && (
        <div className="ai-similar-viewer">
          <Suspense fallback={null}>
            <Viewer
              items={items}
              index={viewer}
              accounts={accounts}
              onIndex={setViewer}
              onClose={() => setViewer(null)}
              action={{ label: `In „${folder.name}“ verschieben`, icon: "move", run: (f) => setMoving(f) }}
            />
          </Suspense>
        </div>
      )}
      {moving && (
        // Über der Foto-Ansicht
        <div className="ai-move-layer">
          <Suspense fallback={null}>
            <MoveSheet
              items={[moving]}
              accounts={accounts}
              target={crumbsOf(folder.path)}
              onClose={(changed) => {
                const k = key(moving);
                setMoving(null);
                if (!changed) return;
                // Aus der Liste nehmen; die Foto-Ansicht zeigt das nächste Foto (oder schliesst, wenn keins mehr da ist)
                const left = items.filter((f) => key(f) !== k);
                setMoved((m) => new Set(m).add(k));
                setViewer((v) => (v === null || !left.length ? null : Math.min(v, left.length - 1)));
              }}
            />
          </Suspense>
        </div>
      )}
    </>
  );
}
