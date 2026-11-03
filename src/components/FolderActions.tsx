import { useEffect, useState } from "react";
import { customHue, FOLDER_HUES, hueOf, setFolderHue, useFolderColors } from "../lib/folderColors";
import { moveLogicalFolder, PRIVAT_SEALED, renameLogicalFolder } from "../lib/folders";
import { childPath, validFolderName } from "../lib/naming";
import { crossesPrivat } from "../lib/placement";
import type { Account, LogicalFolder } from "../lib/types";
import Icon from "./Icon";
import PathPicker from "./PathPicker";
import { useUI } from "./ui";

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
  const parentKey = folder.key.split("/").slice(0, -1).join("/");

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
      <PathPicker
        subtitle={`„${folder.name}“ verschieben nach …`}
        exclude={folder.key}
        check={(c) =>
          c.key === parentKey ? "Liegt schon hier" : crossesPrivat(folder.path, childPath(c.path, folder.name)) ? PRIVAT_SEALED : null
        }
        confirmLabel={(c) => `Nach „${c.key ? c.name : "Drive"}“ verschieben`}
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
