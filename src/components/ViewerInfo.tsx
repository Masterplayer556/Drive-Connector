// Info-Fenster der Foto-Ansicht (⋯ → Info): alle Angaben zum Foto auf einen Blick.
import { useEffect, useState } from "react";
import { formatBytes, formatDateTime } from "../lib/format";
import { markerColor } from "../lib/tags";
import { accountColor } from "../lib/theme";
import type { Account, Item } from "../lib/types";
import Icon from "./Icon";

export default function ViewerInfo({
  item,
  accounts,
  tags,
  ai,
  onTags,
  onClose,
}: {
  item: Item;
  accounts: Account[];
  tags: string[];
  /** KI-Suche an → auch die gegebenen Namen zeigen */
  ai: boolean;
  onTags: () => void;
  onClose: () => void;
}) {
  const [names, setNames] = useState<string[] | null>(null);
  useEffect(() => {
    if (!ai) return;
    let alive = true;
    void import("../ai/search")
      .then((m) => m.namesOf(item))
      .then((n) => alive && setNames(n))
      .catch(() => alive && setNames([]));
    return () => {
      alive = false;
    };
  }, [ai, item]);

  const accIndex = accounts.findIndex((a) => a.id === item.account_id);
  const account = accounts[accIndex];
  const folder = item.path ? (item.path.includes("/") ? item.path.replace(/\/[^/]*$/, "") : "Drive") : null;
  const driveUrl = `https://drive.google.com/file/d/${encodeURIComponent(item.drive_id)}/view${account ? `?authuser=${encodeURIComponent(account.email)}` : ""}`;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      {/* Eigene Ebene über die ganze Bildschirmhöhe: das Fenster sitzt unten und ist nur so hoch wie nötig
          (als App auf dem Home-Bildschirm misst iOS „unten“ sonst falsch – siehe .sheet in styles.css) */}
      <div className="viewer-info-layer">
      <div className="sheet viewer-info-sheet">
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2>Info</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Schliessen">
            <Icon name="x" />
          </button>
        </div>
        <div className="sheet-body">
          <dl className="info-list">
            <Row icon="image" label="Name">
              {item.name}
            </Row>
            {folder && (
              <Row icon="folder" label="Ordner">
                {folder}
              </Row>
            )}
            <Row icon="calendar" label="Aufgenommen">
              {item.taken_at ? formatDateTime(item.taken_at) : "Unbekannt"}
            </Row>
            <Row icon="archive" label="Grösse">
              {formatBytes(item.size)}
              {item.mime_type && <span className="faint"> · {item.mime_type.replace(/^\w+\//, "").toUpperCase()}</span>}
            </Row>
            {account && (
              <Row icon="user" label="Konto">
                <span className="dot" style={{ background: accountColor(accIndex), color: accountColor(accIndex) }} /> {account.email}
              </Row>
            )}
            {item.description && (
              <Row icon="pencil" label="Beschreibung">
                {item.description}
              </Row>
            )}
            <Row icon="tag" label="Tags">
              {tags.length ? (
                <span className="tag-chips">
                  {tags.map((t) => {
                    const c = markerColor(t);
                    return (
                      <span key={t} className="tag-chip">
                        {c ? <i className="tag-chip-dot" style={{ background: c }} /> : "#"}
                        {t}
                      </span>
                    );
                  })}
                </span>
              ) : (
                <span className="faint">Keine</span>
              )}{" "}
              <button className="btn ghost small" onClick={onTags}>
                Bearbeiten
              </button>
            </Row>
            {ai && (
              <Row icon="sparkles" label="Namen (KI)">
                {names === null ? <span className="spinner" style={{ width: 14, height: 14 }} /> : names.length ? names.join(", ") : <span className="faint">Keine</span>}
              </Row>
            )}
          </dl>
          <a className="btn ghost block" style={{ textDecoration: "none" }} href={driveUrl} target="_blank" rel="noreferrer">
            <Icon name="externalLink" size={17} /> In Google Drive öffnen
          </a>
        </div>
      </div>
      </div>
    </>
  );
}

function Row({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return (
    <div className="info-row">
      <span className="info-icon">
        <Icon name={icon} size={17} />
      </span>
      <div style={{ minWidth: 0 }}>
        <dt className="faint small">{label}</dt>
        <dd>{children}</dd>
      </div>
    </div>
  );
}
