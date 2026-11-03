// KI-SUCHE (Test): „Ähnliche Fotos“ – aus der Foto-Ansicht. Rechnet nur mit dem lokalen Index (kein Modell).
import "./ai.css";
import { lazy, Suspense, useEffect, useState } from "react";
import Icon from "../components/Icon";
import Thumb from "../components/Thumb";
import type { Account, Item } from "../lib/types";
import { similarTo } from "./search";

const Viewer = lazy(() => import("../components/Viewer"));

export default function SimilarSheet({ item, accounts, onClose }: { item: Item; accounts: Account[]; onClose: () => void }) {
  const [items, setItems] = useState<Item[] | null | undefined>(undefined); // undefined = lädt, null = nicht gelernt
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);

  useEffect(() => {
    similarTo(item)
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [item]);

  return (
    <>
      <div className="sheet-backdrop ai-similar-layer" onClick={onClose} />
      <div className="sheet search-sheet ai-similar-layer">
        <div className="sheet-grip" />
        <div className="search-bar">
          <strong className="ai-similar-title">
            <Icon name="sparkles" size={16} /> Ähnliche Fotos
          </strong>
          <button className="btn ghost small" onClick={onClose}>
            Fertig
          </button>
        </div>
        <div className="sheet-body">
          <div className="ai-similar-src">
            <div className="ai-similar-thumb">
              <Thumb item={item} />
            </div>
            <span className="muted small ellipsis">{item.name}</span>
          </div>
          {error ? (
            <p className="muted small">Nicht möglich: {error}</p>
          ) : items === undefined ? (
            <div className="spinner" style={{ margin: "24px auto" }} />
          ) : items === null ? (
            <p className="muted small">Dieses Foto hat die KI noch nicht gelernt – später nochmals versuchen.</p>
          ) : items.length === 0 ? (
            <p className="muted small">Keine ähnlichen Fotos gefunden.</p>
          ) : (
            <div className="grid stagger" style={{ padding: "8px 0" }}>
              {items.map((f, i) => (
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
          )}
        </div>
      </div>
      {viewer !== null && items && items[viewer] && (
        <div className="ai-similar-viewer">
          <Suspense fallback={null}>
            <Viewer items={items} index={viewer} accounts={accounts} onIndex={setViewer} onClose={() => setViewer(null)} />
          </Suspense>
        </div>
      )}
    </>
  );
}
