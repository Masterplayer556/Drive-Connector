import { useEffect, useMemo, useRef, useState } from "react";
import { invalidateAll, invalidateFolder, loadFolder, patchFolder } from "../lib/cache";
import { fetchFolderParts, syncAccounts, writeLogs, type LogInput } from "../lib/db";
import { moveLogicalFolder, PathResolver, pathSegments, PRIVAT_SEALED } from "../lib/folders";
import { crossesPrivat } from "../lib/placement";
import { moveWithin } from "../lib/google";
import { planMove } from "../lib/move";
import { childKey, childPath } from "../lib/naming";
import { folderHue } from "../lib/theme";
import type { Account, Crumb, FolderContent, Item, LogicalFolder } from "../lib/types";
import Icon from "./Icon";
import Ring from "./Ring";

const ROOT: Crumb = { name: "Drive", path: "", key: "" };

/** Fotos und Ordner verschieben (#10): Zielordner wählen, Konflikte klären, verschieben. */
export default function MoveSheet({
  items,
  folders = [],
  accounts,
  target,
  onClose,
}: {
  items: Item[];
  /** Ziel schon gewählt (z. B. per Ziehen): Pfad dorthin. Ohne Rückfragen wird dann gleich verschoben. */
  target?: Crumb[];
  /** Ausgewählte Ordner – wandern samt Inhalt, jeder Teil bleibt in seinem Konto */
  folders?: LogicalFolder[];
  accounts: Account[];
  onClose: (changed: boolean) => void;
}) {
  const [stack, setStack] = useState<Crumb[]>(() => (target?.length ? [ROOT, ...target.filter((c) => c.key)] : [ROOT]));
  const current = stack[stack.length - 1];
  const [content, setContent] = useState<FolderContent | null>(null);
  const [conflictMode, setConflictMode] = useState<"skip" | "rename">("skip");
  const [phase, setPhase] = useState<"pick" | "run" | "done">("pick");
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);

  useEffect(() => {
    setContent(null);
    loadFolder(current.key)
      .then(setContent)
      .catch(() => setContent({ folders: [], files: [] }));
  }, [current.key]);

  const plan = useMemo(
    () =>
      content && current.key
        ? planMove({
            items,
            targetKey: current.key,
            existingNames: content.files.map((f) => f.name),
            targetBytes: content.files.reduce((s, f) => s + (f.size ?? 0), 0),
            targetHasSubfolders: content.folders.length > 0,
            conflictMode,
            now: new Date(),
          })
        : [],
    [content, current.key, items, conflictMode],
  );
  const count = (s: string) => plan.filter((e) => e.status === s).length;
  // Ordner: nicht in sich selbst, und wenn sie schon hier liegen, bleiben sie
  const parentOf = (k: string) => k.split("/").slice(0, -1).join("/");
  const folderTodo = folders.filter((f) => parentOf(f.key) !== current.key);
  const merging = folderTodo.filter((f) => content?.folders.some((x) => x.key === childKey(current.key, f.name)));
  // Privat ist abgeschottet: keine Fotos oder Ordner hinein oder heraus
  const sealed =
    !!current.key &&
    (items.some((i) => crossesPrivat(i.path ?? "", current.path)) ||
      folders.some((f) => crossesPrivat(f.path, childPath(current.path, f.name))));
  const total = count("move") + folderTodo.length;
  const what = [
    items.length ? `${items.length} Foto${items.length === 1 ? "" : "s"}` : "",
    folders.length ? `${folders.length} Ordner` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const conflictsIfSkip = useMemo(
    () =>
      content && current.key
        ? planMove({
            items,
            targetKey: current.key,
            existingNames: content.files.map((f) => f.name),
            targetBytes: 0,
            targetHasSubfolders: true,
            conflictMode: "skip",
            now: new Date(),
          }).filter((e) => e.status === "conflict").length
        : 0,
    [content, current.key, items],
  );

  // Ziel per Ziehen gewählt: ohne Namenskonflikte, 15-GB-Grenze und Privat-Sperre gleich verschieben
  const autoTried = useRef(false);
  useEffect(() => {
    if (!target || autoTried.current || phase !== "pick" || !content || !current.key) return;
    autoTried.current = true;
    if (!sealed && total > 0 && conflictsIfSkip === 0 && count("limit") === 0 && merging.length === 0) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, current.key, phase]);

  const run = async () => {
    const todo = plan.filter((e) => e.status === "move");
    setPhase("run");
    const errors: string[] = [];
    // 1. Ordner (samt Inhalt) – jeder Teil bleibt in seinem Konto
    for (const f of folderTodo) {
      try {
        await moveLogicalFolder(f, current, accounts);
      } catch (err) {
        errors.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
      setDone((d) => d + 1);
    }
    if (folderTodo.length) invalidateAll();
    if (!todo.length) {
      invalidateFolder(current.key);
      setFailed(errors);
      setPhase("done");
      return;
    }
    const logs: LogInput[] = [];
    const parts = await fetchFolderParts(current.path);
    const parentBy = new Map(parts.map((p) => [p.account_id, p.drive_id]));
    const resolver = new PathResolver(accounts);
    const gone = new Set<string>();
    for (const e of todo) {
      try {
        let parent = parentBy.get(e.item.account_id);
        if (!parent) {
          parent = await resolver.ensure(e.item.account_id, pathSegments(current.path));
          parentBy.set(e.item.account_id, parent);
        }
        if (!e.item.parent_drive_id) throw new Error("Ursprungsordner unbekannt");
        await moveWithin(
          e.item.account_id,
          e.item.drive_id,
          parent,
          e.item.parent_drive_id,
          e.renamed ? { name: e.targetName, description: `Originalname: ${e.item.name}` } : {},
        );
        gone.add(`${e.item.account_id}|${e.item.drive_id}`);
        if (e.renamed) {
          logs.push({ kind: "rename", message: `„${e.item.name}“ → „${e.targetName}“ (Namenskonflikt beim Verschieben)` });
        }
      } catch (err) {
        errors.push(`${e.item.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
      setDone((d) => d + 1);
    }
    const moved = gone.size;
    logs.unshift({
      kind: "move",
      message: `${moved} Foto${moved === 1 ? "" : "s"} nach „${current.path}“ verschoben`,
      details: { von: [...new Set(todo.map((e) => e.item.path?.replace(/\/[^/]*$/, "")))] },
    });
    await writeLogs(logs);
    // Abgleich: schlägt er fehl, zeigt die App sonst den alten Stand (Foto scheinbar nicht verschoben)
    const ids = [...new Set(todo.map((e) => e.item.account_id))];
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await syncAccounts(ids).catch(() => null);
      if (res && !res.some((r) => r.error)) break;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
    // Verschobene Fotos sofort aus dem alten Ordner nehmen
    for (const k of new Set(items.map((i) => i.parent_key ?? ""))) {
      patchFolder(k, (c) => ({ ...c, files: c.files.filter((f) => !gone.has(`${f.account_id}|${f.drive_id}`)) }));
    }
    invalidateFolder(current.key);
    for (const k of new Set(items.map((i) => i.parent_key ?? ""))) invalidateFolder(k);
    setFailed(errors);
    setPhase("done");
  };

  return (
    <>
      <div className="sheet-backdrop" />
      <div className="sheet">
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div style={{ minWidth: 0 }}>
            <div className="muted small ellipsis">
              {what} verschieben nach …
            </div>
            <h2 className="ellipsis">{phase === "done" ? "Verschoben" : current.key ? current.name : "Ziel wählen"}</h2>
          </div>
          {phase !== "run" && (
            <button className="icon-btn" onClick={() => onClose(phase === "done")} aria-label="Schliessen">
              <Icon name="x" />
            </button>
          )}
        </div>
        <div className="sheet-body">
          {phase === "pick" && (
            <>
              <div className="crumbs" style={{ paddingTop: 0 }}>
                {stack.map((c, i) => (
                  <button
                    key={c.key + i}
                    className={`crumb ${i === stack.length - 1 ? "current" : ""}`}
                    onClick={() => setStack((s) => s.slice(0, i + 1))}
                  >
                    {i === 0 ? <Icon name="grid" size={13} /> : null}
                    {c.name}
                  </button>
                ))}
              </div>
              {!content ? (
                <div className="spinner" style={{ alignSelf: "center" }} />
              ) : content.folders.filter((f) => !folders.some((x) => x.key === f.key)).length === 0 ? (
                <p className="muted small">Keine Unterordner.</p>
              ) : (
                <div className="folders stagger" style={{ padding: 0 }}>
                  {content.folders.filter((f) => !folders.some((x) => x.key === f.key)).map((f, i) => (
                    <button
                      key={f.key}
                      className="folder"
                      style={{ ["--i" as string]: i, ["--h" as string]: folderHue(f.name) }}
                      onClick={() =>
                        setStack((s) => [...s, { name: f.name, path: f.path || childPath(current.path, f.name), key: childKey(current.key, f.name) }])
                      }
                    >
                      <span className="folder-icon">
                        <Icon name="folder" size={18} />
                      </span>
                      <span className="folder-name">{f.name}</span>
                    </button>
                  ))}
                </div>
              )}

              {current.key && content && (
                <>
                  {conflictsIfSkip > 0 && (
                    <div className="card glass stack" style={{ margin: 0 }}>
                      <strong>
                        {conflictsIfSkip} Name{conflictsIfSkip === 1 ? "" : "n"} gibt es dort schon
                      </strong>
                      <label className={`choice ${conflictMode === "skip" ? "on" : ""}`}>
                        <input type="radio" checked={conflictMode === "skip"} onChange={() => setConflictMode("skip")} />
                        Überspringen
                      </label>
                      <label className={`choice ${conflictMode === "rename" ? "on" : ""}`}>
                        <input type="radio" checked={conflictMode === "rename"} onChange={() => setConflictMode("rename")} />
                        Mit „Foto_Datum“-Namen verschieben
                      </label>
                    </div>
                  )}
                  {count("limit") > 0 && (
                    <div className="banner warn" style={{ margin: 0, width: "100%" }}>
                      <Icon name="alert" size={18} />
                      <span>Ziel erreicht 15 GB – {count("limit")} Foto(s) passen nicht mehr hinein.</span>
                    </div>
                  )}
                  {sealed && (
                    <div className="banner warn" style={{ margin: 0, width: "100%" }}>
                      <Icon name="lock" size={18} />
                      <span>{PRIVAT_SEALED}.</span>
                    </div>
                  )}
                  {merging.length > 0 && !sealed && (
                    <p className="faint small" style={{ margin: 0 }}>
                      {merging.map((f) => `„${f.name}“`).join(", ")} gibt es hier schon – die Inhalte werden zusammengeführt.
                    </p>
                  )}
                  <button className="btn primary block" disabled={sealed || total === 0} onClick={run}>
                    <Icon name="move" size={18} /> {total} hierher verschieben
                  </button>
                  {count("same") + folders.length - folderTodo.length > 0 && (
                    <p className="faint small">{count("same") + folders.length - folderTodo.length} liegen schon hier.</p>
                  )}
                </>
              )}
            </>
          )}
          {phase === "run" && <Ring value={done} total={total} label="verschoben" />}
          {phase === "done" && (
            <>
              <div className="done-check">
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <h2 style={{ textAlign: "center" }}>Nach „{current.path}“ verschoben</h2>
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
