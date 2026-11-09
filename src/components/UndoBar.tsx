import { useEffect, useState } from "react";
import { clearUndo, subscribeUndo, UNDO_MS, type UndoOffer } from "../lib/undo";
import Icon from "./Icon";
import { useUI } from "./ui";

/** Leiste unten: 10 Sekunden „Rückgängig“ nach Verschieben oder Umbenennen. */
export default function UndoBar() {
  const ui = useUI();
  const [offer, setOffer] = useState<UndoOffer | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeUndo(setOffer), []);

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

  return (
    <div key={offer.id} className="undo-bar glass" role="status">
      <span className="undo-text ellipsis">{offer.label}</span>
      <button className="btn small undo-btn" disabled={busy} onClick={undo}>
        {busy ? <span className="spinner" /> : <Icon name="rotateCcw" size={16} />} Rückgängig
      </button>
      {!busy && <span className="undo-timer" style={{ animationDuration: `${UNDO_MS}ms` }} />}
    </div>
  );
}
