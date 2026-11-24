import { useEffect, useRef, useState } from "react";
import { clearUndo, subscribeUndo, UNDO_MS, type UndoOffer } from "../lib/undo";
import Icon from "./Icon";
import { useUI } from "./ui";

/** Leiste unten: 10 Sekunden „Rückgängig“ nach Verschieben, Umbenennen oder Löschen. Wegwischen blendet sie aus. */
export default function UndoBar() {
  const ui = useUI();
  const [offer, setOffer] = useState<UndoOffer | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeUndo(setOffer), []);
  // Wegwischen: seitwärts oder nach unten
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [out, setOut] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    setDrag(null);
    setOut(null);
  }, [offer?.id]);

  useEffect(() => {
    if (!offer || busy) return;
    const t = setTimeout(() => clearUndo(offer.id), UNDO_MS);
    return () => clearTimeout(t);
  }, [offer, busy]);

  if (!offer) return null;

  const undo = async () => {
    setBusy(true);
    try {
      await offer.run();
      ui.toast("Rückgängig gemacht", "ok");
    } catch (e) {
      ui.toast(`Rückgängig fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy(false);
      clearUndo(offer.id);
    }
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (busy || (e.target as HTMLElement).closest("button")) return;
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!start.current) return;
    const x = e.touches[0].clientX - start.current.x;
    const y = e.touches[0].clientY - start.current.y;
    // Seitwärts frei, nach unten frei, nach oben nur ein wenig (Gummiband)
    setDrag(Math.abs(x) > Math.abs(y) ? { x, y: 0 } : { x: 0, y: y > 0 ? y : y * 0.2 });
  };
  const onTouchEnd = () => {
    if (!start.current) return;
    start.current = null;
    if (drag && (Math.abs(drag.x) > 70 || drag.y > 30)) {
      const id = offer.id;
      setOut(drag.y > 30 ? { x: 0, y: 160 } : { x: Math.sign(drag.x) * window.innerWidth, y: 0 });
      setTimeout(() => clearUndo(id), 220);
    } else setDrag(null);
  };
  const pos = out ?? drag;

  return (
    <div
      key={offer.id}
      className={`undo-bar glass ${drag && !out ? "dragging" : ""} ${pos ? "moved" : ""}`}
      role="status"
      style={pos ? { transform: `translate(${pos.x}px, ${pos.y}px)`, opacity: out ? 0 : 1 - Math.min(Math.abs(pos.x) / 300, 0.6) } : undefined}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <span className="undo-text ellipsis">{offer.label}</span>
      <button className="btn small undo-btn" disabled={busy} onClick={undo}>
        {busy ? <span className="spinner" /> : <Icon name="rotateCcw" size={16} />} Rückgängig
      </button>
      {!busy && <span className="undo-timer" style={{ animationDuration: `${UNDO_MS}ms` }} />}
    </div>
  );
}
