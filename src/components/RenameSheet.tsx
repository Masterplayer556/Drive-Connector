// Auswahl umbenennen: mehrere Fotos und/oder Ordner auf einmal („Name 1“, „Name 2“ …).
import { useEffect, useMemo, useRef, useState } from "react";
import { offerUndo, undoAll, undoFileRenames, undoFolderRename } from "../lib/undo";
import { syncAccounts, writeLogs, type LogInput } from "../lib/db";
import { renameLogicalFolder } from "../lib/folders";
import { updateItem } from "../lib/google";
import { validFolderName } from "../lib/naming";
import { planBatchRename } from "../lib/renameplan";
import type { Item, LogicalFolder } from "../lib/types";
import Icon from "./Icon";
import Ring from "./Ring";
import { useKeepAwake } from "../lib/wakelock";

const key = (i: Item) => `${i.account_id}|${i.drive_id}`;
const PREVIEW = 8;

export default function RenameSheet({
  items,
  folders,
  folderFiles,
  folderFolders,
  folderPath,
  onClose,
}: {
  items: Item[];
  folders: LogicalFolder[];
  /** Alle Fotos und Unterordner im aktuellen Ordner (für Namenskonflikte) */
  folderFiles: Item[];
  folderFolders: LogicalFolder[];
  folderPath: string;
  onClose: (changed: boolean) => void;
}) {
  const [base, setBase] = useState("");
  const [start, setStart] = useState("1");
  const [phase, setPhase] = useState<"edit" | "run" | "done">("edit");
  useKeepAwake(phase === "run"); // Bildschirm bleibt an, solange es läuft
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 150);
    return () => clearTimeout(t);
  }, []);

  const startNum = Math.max(0, Number.parseInt(start, 10) || 0);
  const photoPlan = useMemo(() => {
    const ids = new Set(items.map(key));
    return planBatchRename({
      entries: items.map((i) => ({ id: key(i), name: i.name })),
      base,
      start: startNum,
      taken: folderFiles.filter((f) => !ids.has(key(f))).map((f) => f.name),
    });
  }, [items, folderFiles, base, startNum]);
  const folderPlan = useMemo(() => {
    const ids = new Set(folders.map((f) => f.key));
    return planBatchRename({
      entries: folders.map((f) => ({ id: f.key, name: f.name })),
      base,
      start: startNum,
      taken: folderFolders.filter((f) => !ids.has(f.key)).map((f) => f.name),
      folders: true,
    });
  }, [folders, folderFolders, base, startNum]);

  const steps = [...folderPlan, ...photoPlan].filter((s) => s.from !== s.to);
  const total = steps.length;
  const invalid = base.trim() ? validFolderName(base) : null;
  const conflict = [...folderPlan, ...photoPlan].find((s) => s.conflict);
  const numbered = items.length > 1 || folders.length > 1;
  const what = [
    items.length ? `${items.length} Foto${items.length === 1 ? "" : "s"}` : "",
    folders.length ? `${folders.length} Ordner` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const run = async () => {
    if (!total || invalid || conflict) return;
    setPhase("run");
    const errors: string[] = [];
    const logs: LogInput[] = [];
    const accounts = new Set<string>();
    const byKey = new Map(items.map((i) => [key(i), i]));
    const folderBy = new Map(folders.map((f) => [f.key, f]));
    const undos: (() => Promise<void>)[] = [];
    const renamedFiles: Item[] = [];
    for (const s of folderPlan) {
      const f = folderBy.get(s.id)!;
      if (s.from === s.to) continue;
      try {
        await renameLogicalFolder(f, s.to); // schreibt selbst ins Protokoll und gleicht ab
        undos.push(undoFolderRename(f, s.to));
      } catch (e) {
        errors.push(`${s.from}: ${e instanceof Error ? e.message : String(e)}`);
      }
      setDone((d) => d + 1);
    }
    for (const s of photoPlan) {
      const it = byKey.get(s.id)!;
      if (s.from === s.to) continue;
      try {
        await updateItem(it.account_id, it.drive_id, { name: s.to, description: `Originalname: ${s.from}` });
        logs.push({ kind: "rename", message: `„${s.from}“ → „${s.to}“`, details: { ordner: folderPath } });
        accounts.add(it.account_id);
        renamedFiles.push(it);
      } catch (e) {
        errors.push(`${s.from}: ${e instanceof Error ? e.message : String(e)}`);
      }
      setDone((d) => d + 1);
    }
    await writeLogs(logs).catch(() => undefined);
    if (accounts.size) await syncAccounts([...accounts]).catch(() => undefined);
    setFailed(errors);
    setPhase("done");
    if (renamedFiles.length) undos.push(undoFileRenames(renamedFiles));
    const n = renamedFiles.length + folderPlan.filter((s) => s.from !== s.to).length;
    if (undos.length) offerUndo(`${n} ${n === 1 ? "Eintrag" : "Einträge"} umbenannt`, undoAll(undos));
  };

  const preview = steps.slice(0, PREVIEW);
  return (
    <>
      <div className="sheet-backdrop" onClick={() => phase === "edit" && onClose(false)} />
      <div className="sheet">
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div style={{ minWidth: 0 }}>
            <div className="muted small ellipsis">{what}</div>
            <h2>{phase === "done" ? "Umbenannt" : "Umbenennen"}</h2>
          </div>
          {phase !== "run" && (
            <button className="icon-btn" onClick={() => onClose(phase === "done")} aria-label="Schliessen">
              <Icon name="x" />
            </button>
          )}
        </div>
        <div className="sheet-body">
          {phase === "edit" && (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void run();
              }}
            >
              <input
                ref={input}
                className="input"
                value={base}
                onChange={(e) => setBase(e.target.value)}
                placeholder="Neuer Name"
                autoCapitalize="sentences"
                autoComplete="off"
                enterKeyHint="done"
              />
              {numbered && (
                <label className="row" style={{ gap: 10, alignItems: "center" }}>
                  <span className="muted small">Nummern ab</span>
                  <input
                    className="input"
                    style={{ width: 90 }}
                    inputMode="numeric"
                    value={start}
                    onChange={(e) => setStart(e.target.value.replace(/[^0-9]/g, ""))}
                  />
                </label>
              )}
              {invalid && <p className="error small">{invalid}</p>}
              {conflict && <p className="error small">„{conflict.to}“ gibt es hier schon</p>}
              {preview.length > 0 && (
                <ul className="names">
                  {preview.map((s) => (
                    <li key={s.id}>
                      {s.from} → <strong>{s.to}</strong>
                    </li>
                  ))}
                  {steps.length > PREVIEW && <li className="faint">… und {steps.length - PREVIEW} weitere</li>}
                </ul>
              )}
              {numbered && !base.trim() && (
                <p className="faint small" style={{ margin: 0 }}>
                  Alle bekommen denselben Namen mit Nummer, z. B. „Pink 1“, „Pink 2“ … Fotos behalten ihre Endung,
                  vergebene Nummern werden übersprungen.
                </p>
              )}
              <button type="submit" className="btn primary block" disabled={!total || !!invalid || !!conflict}>
                <Icon name="pencil" size={18} /> {total || ""} umbenennen
              </button>
            </form>
          )}
          {phase === "run" && <Ring value={done} total={total} label="umbenannt" />}
          {phase === "done" && (
            <>
              <div className="done-check">
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <h2 style={{ textAlign: "center" }}>{total - failed.length} umbenannt</h2>
              {failed.length > 0 && (
                <div className="banner error" style={{ margin: 0, width: "100%", display: "block" }}>
                  <ul className="names">
                    {failed.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
              <button className="btn primary block" onClick={() => onClose(true)}>
                Fertig
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
