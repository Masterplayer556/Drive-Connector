import { useEffect, useState } from "react";
import { loadFolder } from "../lib/cache";
import { hueOf } from "../lib/folderColors";
import { childKey, childPath, validFolderName } from "../lib/naming";
import type { Crumb, FolderContent } from "../lib/types";
import Icon from "./Icon";
import { useUI } from "./ui";

export const ROOT: Crumb = { name: "Drive", path: "", key: "" };

/** Brotkrumen vom Drive bis zum Pfad (für den Start der Auswahl im aktuellen Ordner). */
export function crumbsOf(path: string): Crumb[] {
  const out: Crumb[] = [ROOT];
  for (const seg of path ? path.split("/") : []) {
    const prev = out[out.length - 1];
    out.push({ name: seg, path: childPath(prev.path, seg), key: childKey(prev.key, seg) });
  }
  return out;
}

/** Zielordner wählen – durch die Ordner tippen, optional neuen Ordner anlegen. */
export default function PathPicker({
  subtitle,
  start = [ROOT],
  exclude,
  check,
  confirmLabel,
  allowNew = false,
  busy = false,
  onPick,
  onCancel,
}: {
  subtitle: string;
  start?: Crumb[];
  /** Ordner, der nicht betreten werden darf (z. B. der zu verschiebende selbst) */
  exclude?: string;
  /** Grund, warum hier nicht gewählt werden kann – oder null */
  check?: (c: Crumb) => string | null;
  confirmLabel: (c: Crumb) => string;
  /** „Neuer Ordner“ anbieten (wird erst beim Hochladen wirklich angelegt) */
  allowNew?: boolean;
  busy?: boolean;
  onPick: (target: Crumb) => void;
  onCancel: () => void;
}) {
  const ui = useUI();
  const [stack, setStack] = useState<Crumb[]>(start);
  const current = stack[stack.length - 1];
  const [content, setContent] = useState<FolderContent | null>(null);
  /** Neu angelegte (noch virtuelle) Ordner, damit sie beim Zurückgehen sichtbar bleiben */
  const [virtual, setVirtual] = useState<Crumb[]>([]);

  useEffect(() => {
    let alive = true;
    setContent(null);
    loadFolder(current.key)
      .then((c) => alive && setContent(c))
      .catch(() => alive && setContent({ folders: [], files: [] }));
    return () => {
      alive = false;
    };
  }, [current.key]);

  const sub = [
    ...(content?.folders ?? []).map((f) => ({ name: f.name, path: f.path || childPath(current.path, f.name), key: f.key })),
    ...virtual.filter((v) => v.key.startsWith(current.key ? current.key + "/" : "") && v.key.split("/").length === (current.key ? current.key.split("/").length + 1 : 1)),
  ].filter((f, i, all) => f.key !== exclude && all.findIndex((x) => x.key === f.key) === i);

  const reason = check?.(current) ?? null;

  const addFolder = async () => {
    const name = await ui.prompt({
      title: "Neuer Ordner",
      message: `in „${current.path || "Drive"}“ – wird beim Hochladen angelegt`,
      placeholder: "Name",
      validate: (v) =>
        validFolderName(v) ?? (sub.some((f) => f.name.toLowerCase() === v.trim().toLowerCase()) ? "Gibt es hier schon" : null),
    });
    if (!name) return;
    const n = name.trim();
    const c: Crumb = { name: n, path: childPath(current.path, n), key: childKey(current.key, n) };
    setVirtual((v) => [...v, c]);
    setStack((s) => [...s, c]);
  };

  return (
    <>
      <div className="sheet-backdrop" onClick={onCancel} />
      <div className="sheet">
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div style={{ minWidth: 0 }}>
            <div className="muted small ellipsis">{subtitle}</div>
            <h2 className="ellipsis">{current.key ? current.name : "Drive"}</h2>
          </div>
          <button className="icon-btn" onClick={onCancel} aria-label="Schliessen">
            <Icon name="x" />
          </button>
        </div>
        <div className="sheet-body stack">
          <div className="crumbs" style={{ paddingTop: 0 }}>
            {stack.map((c, i) => (
              <button
                key={c.key || "root"}
                className={`crumb ${i === stack.length - 1 ? "current" : ""}`}
                onClick={() => setStack(stack.slice(0, i + 1))}
              >
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
                  onClick={() => setStack([...stack, f])}
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
          {allowNew && current.key !== "" && (
            <button className="btn small ghost" style={{ alignSelf: "flex-start" }} onClick={addFolder}>
              <Icon name="plus" size={16} /> Neuer Ordner
            </button>
          )}
          {reason && <p className="muted small" style={{ textAlign: "center", margin: 0 }}>{reason}</p>}
          <button className="btn primary block" disabled={busy || !!reason} onClick={() => onPick(current)}>
            {busy ? <span className="spinner" /> : null}
            {confirmLabel(current)}
          </button>
        </div>
      </div>
    </>
  );
}
