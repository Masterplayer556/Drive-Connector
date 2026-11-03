import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import { LineSkeleton } from "../components/Skeleton";
import Thumb from "../components/Thumb";
import Topbar from "../components/Topbar";
import { useUI } from "../components/ui";
import { deleteShareRow, fetchShares, writeLog, type Share } from "../lib/db";
import { formatDateTime } from "../lib/format";
import { deletePermission } from "../lib/google";
import { navigate } from "../lib/route";
import type { Account, Item } from "../lib/types";

const asItem = (s: Share): Item => ({
  account_id: s.account_id, drive_id: s.drive_id, name: s.name, is_folder: false, mime_type: null,
  parent_drive_id: null, size: null, md5: null, taken_at: null, description: null, path: null, parent_key: null,
});

/** Geteilte Links (#15): anzeigen, kopieren, entfernen. */
export default function LinksView({ accounts }: { accounts: Account[] }) {
  const ui = useUI();
  const [shares, setShares] = useState<Share[] | null>(null);

  const load = () => fetchShares().then(setShares).catch((e) => ui.toast(String(e), "error"));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (s: Share) => {
    const ok = await ui.confirm({ title: "Link entfernen?", message: `„${s.name}“ ist danach nicht mehr über den Link erreichbar.`, confirmLabel: "Entfernen", danger: true });
    if (!ok) return;
    try {
      await deletePermission(s.account_id, s.drive_id, s.permission_id);
      await deleteShareRow(s.id);
      await writeLog("account", `Teilen-Link für „${s.name}“ entfernt`);
      ui.toast("Link entfernt", "ok");
      await load();
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const copy = async (s: Share) => {
    try {
      await navigator.clipboard.writeText(s.url);
      ui.toast("Link kopiert", "ok");
    } catch {
      ui.toast("Kopieren nicht möglich", "error");
    }
  };

  const now = Date.now();
  return (
    <div className="view page-forward">
      <Topbar
        eyebrow={shares ? `${shares.length} aktiv` : "Lädt …"}
        title="Geteilte Links"
        left={
          <button className="icon-btn" onClick={() => navigate("mehr")} aria-label="Zurück">
            <Icon name="chevronLeft" />
          </button>
        }
      />
      {shares === null ? (
        <LineSkeleton />
      ) : shares.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            <Icon name="link" size={30} />
          </div>
          <strong>Keine geteilten Links</strong>
          <span>In der Foto-Ansicht auf das Ketten-Symbol tippen.</span>
        </div>
      ) : (
        <div className="stagger">
          {shares.map((s, i) => {
            const expired = s.expires_at && Date.parse(s.expires_at) < now;
            return (
              <section key={s.id} className="card glass share-row" style={{ ["--i" as string]: i }}>
                <div className="share-thumb">
                  <Thumb item={asItem(s)} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ellipsis" style={{ fontWeight: 600 }}>{s.name}</div>
                  <span className={`status-pill ${expired ? "err" : ""}`}>
                    {expired ? "abgelaufen" : s.expires_at ? `bis ${formatDateTime(s.expires_at)}` : "unbegrenzt"}
                  </span>
                  <div className="faint small ellipsis">{accounts.find((a) => a.id === s.account_id)?.email}</div>
                </div>
                <div className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
                  <button className="icon-btn" onClick={() => copy(s)} aria-label="Kopieren">
                    <Icon name="copy" size={18} />
                  </button>
                  <button className="icon-btn" onClick={() => remove(s)} aria-label="Entfernen">
                    <Icon name="trash" size={18} />
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
