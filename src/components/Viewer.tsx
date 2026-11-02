import { useEffect, useRef, useState } from "react";
import { formatBytes, formatDateTime } from "../lib/format";
import { downloadBlob, sizedThumb } from "../lib/google";
import type { Account, Item } from "../lib/types";

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

  useEffect(() => {
    let revoke: string | null = null;
    setError(false);
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

  const onImgError = () => {
    if (src?.startsWith("blob:")) return setError(true);
    downloadBlob(item.account_id, item.drive_id)
      .then((b) => setSrc(URL.createObjectURL(b)))
      .catch(() => setError(true));
  };

  const account = accounts.find((a) => a.id === item.account_id);
  const touchX = useRef<number | null>(null);

  return (
    <div
      className="viewer"
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (dx > 60 && index > 0) onIndex(index - 1);
        if (dx < -60 && index < items.length - 1) onIndex(index + 1);
        touchX.current = null;
      }}
    >
      <div className="viewer-top">
        <button className="btn ghost" onClick={onClose}>
          ✕
        </button>
        <span className="viewer-title">{item.name}</span>
        <span className="muted">
          {index + 1}/{items.length}
        </span>
      </div>
      <div className="viewer-img">
        {error ? (
          <p className="muted">Bild konnte nicht geladen werden.</p>
        ) : src ? (
          <img src={src} alt={item.name} referrerPolicy="no-referrer" onError={onImgError} />
        ) : (
          <p className="muted">Lädt …</p>
        )}
      </div>
      <div className="viewer-info muted">
        {formatBytes(item.size)}
        {item.taken_at && <> · aufgenommen {formatDateTime(item.taken_at)}</>}
        {account && <> · {account.email}</>}
        {item.description && <div>{item.description}</div>}
      </div>
      <div className="viewer-nav">
        <button className="btn" disabled={index === 0} onClick={() => onIndex(index - 1)}>
          ‹ Zurück
        </button>
        <button className="btn" disabled={index === items.length - 1} onClick={() => onIndex(index + 1)}>
          Weiter ›
        </button>
      </div>
    </div>
  );
}
