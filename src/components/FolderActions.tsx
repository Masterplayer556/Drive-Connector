import { useEffect, useState } from "react";
import { loadFolder } from "../lib/cache";
import { customHue, FOLDER_HUES, hueOf, setFolderHue, useFolderColors } from "../lib/folderColors";
import { moveLogicalFolder, renameLogicalFolder } from "../lib/folders";
import { validFolderName } from "../lib/naming";
import type { Account, Crumb, FolderContent, LogicalFolder } from "../lib/types";
import Icon from "./Icon";
import { useUI } from "./ui";

const ROOT: Crumb = { name: "Drive", path: "", key: "" };

/** Menü beim Gedrückthalten eines Ordners: öffnen, Farbe, umbenennen, verschieben, ZIP, löschen. */
export default function FolderActions({
  folder,
  accounts,
  protectedFolder,
  onOpen,
  onZip,
  onDelete,
  onChanged,
  onClose,
}: {
  folder: LogicalFolder;
  accounts: Account[];
  /** Bereichsordner (Archiv/Privat) dürfen nicht umbenannt, verschoben oder gelöscht werden */
  protectedFolder: boolean;
  onOpen: () => void;
  onZip: () => void;
  onDelete: () => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const ui = useUI();
  useFolderColors();
  const [picking, setPicking] = useState(false);
  // Die ersten Augenblicke nach dem Öffnen keine Berührungen annehmen (Finger liegt evtl. noch auf)
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 400);
    return () => clearTimeout(t);
  }, []);
  const [busy, setBusy] = useState(false);
  const current = customHue(folder.key);

  const rename = async () => {
    const name = await ui.prompt({
      title: "Ordner umbenennen",
      message: `„${folder.path}“ – wird in allen Konten umbenannt`,
      placeholder: "Neuer Name",
      initial: folder.name,
      validate: (v) => (v === folder.name ? "Gleicher Name" : validFolderName(v)),
    });
    if (!name) return;
    setBusy(true);
    try {
      await renameLogicalFolder(folder, name);
      ui.toast(`Umbenannt in „${name}“`, "ok");
      onChanged();
      onClose();
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const color = async (hue: number | null) => {
    try {
      await setFolderHue(folder.key, hue);
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  if (picking) {
    return (
      <FolderPicker
        folder={folder}
        onCancel={() => setPicking(false)}
        onPick={async (target) => {
          setBusy(true);
          try {
            await moveLogicalFolder(folder, target, accounts);
            ui.toast(`„${folder.name}“ nach „${target.path || "Drive"}“ verschoben`, "ok");
            onChanged();
            onClose();
          } catch (e) {
            ui.toast(e instanceof Error ? e.message : String(e), "error");
            setBusy(false);
          }
        }}
        busy={busy}
      />
    );
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={() => armed && onClose()} />
      <div className="sheet folder-actions" style={{ pointerEvents: armed ? undefined : "none" }}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div className="row" style={{ gap: 12, minWidth: 0 }}>
            <span className="folder-icon" style={{ ["--h" as string]: hueOf(folder.key, folder.name) }}>
              <Icon name="folder" size={20} />
            </span>
            <div style={{ minWidth: 0 }}>
              <h2 className="ellipsis">{folder.name}</h2>
              <div className="muted small ellipsis">
                {folder.path}
                {folder.parts.length > 1 ? ` · ${folder.parts.length} Konten` : ""}
              </div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Schliessen">
            <Icon name="x" />
          </button>
        </div>
        <div className="sheet-body stack">
          <div className="swatches" role="radiogroup" aria-label="Ordnerfarbe">
            <button className={`swatch auto ${current === null ? "on" : ""}`} onClick={() => color(null)} aria-label="Automatisch" title="Automatisch">
              A
            </button>
            {FOLDER_HUES.map((h) => (
              <button
                key={h}
                className={`swatch ${current === h ? "on" : ""}`}
                style={{ ["--h" as string]: h }}
                onClick={() => color(h)}
                aria-label={`Farbe ${h}`}
              />
            ))}
          </div>
          <div className="action-list">
            <button className="action" onClick={onOpen}>
              <Icon name="chevronRight" size={18} /> Öffnen
            </button>
            {!protectedFolder && (
              <>
                <button className="action" onClick={rename} disabled={busy}>
                  <Icon name="pencil" size={18} /> Umbenennen
                </button>
                <button className="action" onClick={() => setPicking(true)} disabled={busy}>
                  <Icon name="move" size={18} /> Verschieben
                </button>
              </>
            )}
            <button className="action" onClick={onZip}>
              <Icon name="download" size={18} /> Als ZIP sichern
            </button>
            {!protectedFolder && (
              <button className="action danger" onClick={onDelete} disabled={busy}>
                <Icon name="trash" size={18} /> Löschen
              </button>
            )}
          </div>
          {busy && <div className="spinner" style={{ alignSelf: "center" }} />}
        </div>
      </div>
    </>
  );
}

/** Zielordner wählen (der Ordner selbst und seine Unterordner sind ausgeschlossen). */
function FolderPicker({
  folder,
  busy,
  onPick,
  onCancel,
}: {
  folder: LogicalFolder;
  busy: boolean;
  onPick: (target: Crumb) => void;
  onCancel: () => void;
}) {
  const [stack, setStack] = useState<Crumb[]>([ROOT]);
  const current = stack[stack.length - 1];
  const [content, setContent] = useState<FolderContent | null>(null);
  useEffect(() => {
    setContent(null);
    loadFolder(current.key)
      .then(setContent)
      .catch(() => setContent({ folders: [], files: [] }));
  }, [current.key]);
  const parentKey = folder.key.split("/").slice(0, -1).join("/");
  const sub = (content?.folders ?? []).filter((f) => f.key !== folder.key);

  return (
    <>
      <div className="sheet-backdrop" onClick={onCancel} />
      <div className="sheet">
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div style={{ minWidth: 0 }}>
            <div className="muted small ellipsis">„{folder.name}“ verschieben nach …</div>
            <h2 className="ellipsis">{current.key ? current.name : "Drive"}</h2>
          </div>
          <button className="icon-btn" onClick={onCancel} aria-label="Schliessen">
            <Icon name="x" />
          </button>
        </div>
        <div className="sheet-body stack">
          <div className="crumbs" style={{ paddingTop: 0 }}>
            {stack.map((c, i) => (
              <button key={c.key || "root"} className={`crumb ${i === stack.length - 1 ? "current" : ""}`} onClick={() => setStack(stack.slice(0, i + 1))}>
                {i === 0 ? "Drive" : c.name}
              </button>
            ))}
          </div>
          {!content ? (
            <div className="spinner" style={{ alignSelf: "center" }} />
          ) : (
            <div className="folders" style={{ padding: 0 }}>
              {sub.map((f) => (
                <button
                  key={f.key}
                  className="folder"
                  style={{ ["--h" as string]: hueOf(f.key, f.name) }}
                  onClick={() => setStack([...stack, { name: f.name, path: f.path, key: f.key }])}
                >
                  <span className="folder-icon">
                    <Icon name="folder" size={18} />
                  </span>
                  <span className="folder-name">{f.name}</span>
                </button>
              ))}
              {!sub.length && <p className="muted small">Keine Unterordner.</p>}
            </div>
          )}
          <button className="btn primary block" disabled={busy || current.key === parentKey} onClick={() => onPick(current)}>
            {busy ? <span className="spinner" /> : <Icon name="move" size={18} />}
            {current.key === parentKey ? "Liegt schon hier" : `Nach „${current.key ? current.name : "Drive"}“ verschieben`}
          </button>
        </div>
      </div>
    </>
  );
}
