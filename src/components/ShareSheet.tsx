import { useState } from "react";
import { insertShare, writeLog } from "../lib/db";
import { formatDateTime } from "../lib/format";
import { createAnyoneLink } from "../lib/google";
import type { Item } from "../lib/types";
import Icon from "./Icon";
import { useUI } from "./ui";

const EXPIRY: { days: number | null; label: string }[] = [
  { days: 1, label: "1 Tag" },
  { days: 7, label: "7 Tage" },
  { days: 30, label: "30 Tage" },
  { days: null, label: "Unbegrenzt" },
];

/** Teilen-Link (#15): „Jeder mit dem Link kann ansehen“, optional mit Ablauf. */
export default function ShareSheet({ item, onClose }: { item: Item; onClose: () => void }) {
  const ui = useUI();
  const [days, setDays] = useState<number | null>(7);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ url: string; expires: string | null } | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const { permissionId, url } = await createAnyoneLink(item.account_id, item.drive_id);
      const expires_at = days ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
      await insertShare({
        account_id: item.account_id,
        drive_id: item.drive_id,
        name: item.name,
        permission_id: permissionId,
        url,
        expires_at,
      });
      await writeLog("account", `Teilen-Link für „${item.name}“ erstellt${days ? ` (${days} Tage gültig)` : ""}`);
      setLink({ url, expires: expires_at });
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      ui.toast("Link kopiert", "ok");
    } catch {
      ui.toast("Kopieren nicht möglich – bitte „Teilen“ verwenden", "error");
    }
  };

  const share = async () => {
    if (!link) return;
    try {
      await navigator.share({ title: item.name, url: link.url });
    } catch {
      /* abgebrochen */
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal glass" onClick={(e) => e.stopPropagation()}>
        <h3>Link teilen</h3>
        <p className="muted small ellipsis">{item.name}</p>
        {!link ? (
          <>
            <span className="small">Gültig für</span>
            <div className="chips" style={{ padding: 0 }}>
              {EXPIRY.map((o) => (
                <button key={o.label} className={`chip ${days === o.days ? "on" : ""}`} onClick={() => setDays(o.days)}>
                  {o.label}
                </button>
              ))}
            </div>
            <p className="faint small">Jeder mit dem Link kann das Foto ansehen. Abgelaufene Links entfernt der nächtliche Abgleich.</p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={onClose}>
                Abbrechen
              </button>
              <button className="btn primary" disabled={busy} onClick={create}>
                {busy ? <span className="spinner" /> : "Link erstellen"}
              </button>
            </div>
          </>
        ) : (
          <>
            <code className="secret" style={{ textAlign: "left" }}>
              {link.url}
            </code>
            <span className="faint small">{link.expires ? `Gültig bis ${formatDateTime(link.expires)}` : "Unbegrenzt gültig"}</span>
            <div className="modal-actions">
              <button className="btn" onClick={copy}>
                <Icon name="copy" size={17} /> Kopieren
              </button>
              <button className="btn primary" onClick={share}>
                <Icon name="share" size={17} /> Teilen
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
