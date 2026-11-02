import { useEffect, useRef, useState } from "react";
import { formatBytes, formatDateTime } from "../lib/format";
import { downloadBlob, sizedThumb } from "../lib/google";
import { accountColor } from "../lib/theme";
import type { Account, Item } from "../lib/types";
import Icon from "./Icon";

export default function Viewer({
  items,
  index,
  links,
  accounts,
  onIndex,
  onClose,
}: {
  items: Item[];
  index: number;
  links: Map<string, string>;
  accounts: Account[];
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const item = items[index];
  const link = links.get(item.drive_id);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [dx, setDx] = useState(0);
  const [closing, setClosing] = useState(false);
  const startX = useRef<number | null>(null);

  useEffect(() => {
    let revoke: string | null = null;
    setError(false);
    setDx(0);
    if (link) {
      setSrc(sizedThumb(link, 1600));
    } else {
      setSrc(null);
      downloadBlob(item.account_id, item.drive_id)
        .then((b) => {
          revoke = URL.createObjectURL(b);
          setSrc(revoke);
        })
        .catch(() => setError(true));
    }
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [item, link]);

  // Nachbarbilder vorladen → Wischen fühlt sich sofort an
  useEffect(() => {
    for (const j of [index - 1, index + 1]) {
      const l = items[j] && links.get(items[j].drive_id);
      if (l) new Image().src = sizedThumb(l, 1600);
    }
  }, [index, items, links]);

  const onImgError = () => {
    if (src?.startsWith("blob:")) return setError(true);
    downloadBlob(item.account_id, item.drive_id)
      .then((b) => setSrc(URL.createObjectURL(b)))
      .catch(() => setError(true));
  };

  const close = () => {
    setClosing(true);
    setTimeout(onClose, 180);
  };

  const accIndex = accounts.findIndex((a) => a.id === item.account_id);
  const account = accounts[accIndex];

  return (
    <div className={`viewer ${closing ? "closing" : ""}`}>
      <div className="viewer-top">
        <button className="icon-btn" onClick={close} aria-label="Schliessen">
          <Icon name="x" />
        </button>
        <span className="viewer-title">{item.name}</span>
        <span className="muted small">
          {index + 1} / {items.length}
        </span>
      </div>
      <div
        className="viewer-stage"
        onTouchStart={(e) => (startX.current = e.touches[0].clientX)}
        onTouchMove={(e) => {
          if (startX.current !== null) setDx(e.touches[0].clientX - startX.current);
        }}
        onTouchEnd={() => {
          if (dx > 70 && index > 0) onIndex(index - 1);
          else if (dx < -70 && index < items.length - 1) onIndex(index + 1);
          else setDx(0);
          startX.current = null;
        }}
      >
        {error ? (
          <p className="muted">Bild konnte nicht geladen werden.</p>
        ) : src ? (
          <img
            key={item.drive_id}
            className={startX.current !== null ? "dragging" : ""}
            src={src}
            alt={item.name}
            referrerPolicy="no-referrer"
            onError={onImgError}
            style={{ transform: dx ? `translateX(${dx}px) rotate(${dx / 40}deg)` : undefined, opacity: 1 - Math.min(Math.abs(dx) / 600, 0.4) }}
          />
        ) : (
          <div className="spinner" />
        )}
      </div>
      <div className="viewer-info glass">
        <span className="chip">
          <Icon name="image" size={15} /> {formatBytes(item.size)}
        </span>
        {item.taken_at && <span className="chip">📅 {formatDateTime(item.taken_at)}</span>}
        {account && (
          <span className="chip">
            <span className="dot" style={{ background: accountColor(accIndex), color: accountColor(accIndex) }} />
            {account.email}
          </span>
        )}
        {item.description && <span className="chip">{item.description}</span>}
      </div>
    </div>
  );
}
