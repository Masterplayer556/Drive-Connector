import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { formatBytes, formatDateTime } from "../lib/format";
import { downloadBlob } from "../lib/google";
import { accountColor } from "../lib/theme";
import { getThumb, peekThumb, VIEW_SIZE } from "../lib/thumbs";
import type { Account, Item } from "../lib/types";
import Icon from "./Icon";
import { isFavorite, loadFavorites, onFavoritesChange, toggleFavorite } from "../lib/favorites";
import { useUI } from "./ui";

const ShareSheet = lazy(() => import("./ShareSheet"));

export default function Viewer({
  items,
  index,
  accounts,
  onIndex,
  onClose,
}: {
  items: Item[];
  index: number;
  accounts: Account[];
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const item = items[index];
  // Sofort: kleine Vorschau aus dem Speicher, dann die scharfe Version
  const [low, setLow] = useState<string | null>(() => peekThumb(item));
  const [high, setHigh] = useState<string | null>(() => peekThumb(item, VIEW_SIZE));
  const [error, setError] = useState(false);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);
  const startX = useRef<number | null>(null);
  const ui = useUI();
  const [fav, setFav] = useState(() => isFavorite(item));
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    void loadFavorites().then(() => setFav(isFavorite(item)));
    return onFavoritesChange(() => setFav(isFavorite(item)));
  }, [item]);

  const heart = async () => {
    try {
      const on = await toggleFavorite(item);
      ui.toast(on ? "Zu Favoriten hinzugefügt" : "Aus Favoriten entfernt", "ok");
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  useEffect(() => {
    let alive = true;
    let revoke: string | null = null;
    setError(false);
    setDx(0);
    setLow(peekThumb(item));
    setHigh(peekThumb(item, VIEW_SIZE));
    if (!peekThumb(item)) void getThumb(item).then((u) => alive && setLow(u)).catch(() => undefined);
    if (!peekThumb(item, VIEW_SIZE)) {
      getThumb(item, VIEW_SIZE)
        .then((u) => alive && setHigh(u))
        .catch(() =>
          // Keine Google-Vorschau → Original laden
          downloadBlob(item.account_id, item.drive_id)
            .then((b) => {
              revoke = URL.createObjectURL(b);
              if (alive) setHigh(revoke);
            })
            .catch(() => alive && setError(true)),
        );
    }
    return () => {
      alive = false;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [item]);

  // Nachbarbilder vorladen → Wischen fühlt sich sofort an
  useEffect(() => {
    for (const j of [index + 1, index - 1]) {
      if (items[j]) void getThumb(items[j], VIEW_SIZE).catch(() => undefined);
    }
  }, [index, items]);

  const close = () => {
    setClosing(true);
    setTimeout(onClose, 180);
  };

  const accIndex = accounts.findIndex((a) => a.id === item.account_id);
  const account = accounts[accIndex];
  const style = {
    transform: dx ? `translateX(${dx}px) rotate(${dx / 40}deg)` : undefined,
    opacity: 1 - Math.min(Math.abs(dx) / 600, 0.4),
  };

  return (
    <div className={`viewer ${closing ? "closing" : ""}`}>
      <div className="viewer-top">
        <button className="icon-btn glass" onClick={close} aria-label="Schliessen">
          <Icon name="x" />
        </button>
        <span className="viewer-title">{item.name}</span>
        <span className="muted small">
          {index + 1}/{items.length}
        </span>
        <button className={`icon-btn glass fav-btn ${fav ? "on" : ""}`} onClick={heart} aria-label="Favorit">
          <Icon name="heart" size={20} />
        </button>
        <button className="icon-btn glass" onClick={() => setSharing(true)} aria-label="Link teilen">
          <Icon name="link" size={19} />
        </button>
      </div>
      <div
        className="viewer-stage"
        onTouchStart={(e) => {
          startX.current = e.touches[0].clientX;
          setDragging(true);
        }}
        onTouchMove={(e) => {
          if (startX.current !== null) setDx(e.touches[0].clientX - startX.current);
        }}
        onTouchEnd={() => {
          setDragging(false);
          if (dx > 70 && index > 0) onIndex(index - 1);
          else if (dx < -70 && index < items.length - 1) onIndex(index + 1);
          else setDx(0);
          startX.current = null;
        }}
      >
        {error && !low ? (
          <p className="muted">Bild konnte nicht geladen werden.</p>
        ) : high || low ? (
          <div key={item.drive_id} className={`viewer-frame ${dragging ? "dragging" : ""}`} style={style}>
            {low && <img className={`viewer-low ${high ? "hide" : ""}`} src={low} alt="" />}
            {high && <img className="viewer-high" src={high} alt={item.name} />}
          </div>
        ) : (
          <div className="spinner" />
        )}
      </div>
      <div className="viewer-info glass">
        <span className="chip-lite">
          <Icon name="image" size={15} /> {formatBytes(item.size)}
        </span>
        {item.taken_at && <span className="chip-lite">📅 {formatDateTime(item.taken_at)}</span>}
        {account && (
          <span className="chip-lite">
            <span className="dot" style={{ background: accountColor(accIndex), color: accountColor(accIndex) }} />
            {account.email}
          </span>
        )}
        {item.description && <span className="chip-lite">{item.description}</span>}
      </div>
      {sharing && (
        <Suspense fallback={null}>
          <ShareSheet item={item} onClose={() => setSharing(false)} />
        </Suspense>
      )}
    </div>
  );
}
