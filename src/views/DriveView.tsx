import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Donut from "../components/Donut";
import Icon from "../components/Icon";
import { FolderSkeleton, GridSkeleton } from "../components/Skeleton";
import Thumb from "../components/Thumb";
import Topbar from "../components/Topbar";
import { useUI } from "../components/ui";
import { AREA_KEYS } from "../lib/areas";
import { loadRebalance } from "../lib/rebalanceData";
import { hueOf, useFolderColors } from "../lib/folderColors";
import FolderActions from "../components/FolderActions";
import { haptic } from "../lib/haptic";
import { movePathPrefs } from "../lib/folders";
import { cachedFolder, invalidateAll, invalidateFolder, loadFolder, patchFolder, prefetchFolder } from "../lib/cache";
import { countSubtreeFiles, fetchBigFolders, fetchStats, fetchSubtreeFiles, syncAccounts, writeLog } from "../lib/db";
import { createLogicalFolder, trashFiles, trashLogicalFolder } from "../lib/folders";
import { formatBytes } from "../lib/format";
import { renameItem } from "../lib/google";
import { warmThumbs } from "../lib/thumbs";
import { childKey, childPath, validFolderName } from "../lib/naming";
import { navigate } from "../lib/route";
import { accountColor } from "../lib/theme";
import type { Account, Crumb, FolderContent, Item, LogicalFolder } from "../lib/types";
import { useCountUp } from "../lib/useCountUp";
import { computeInsights, type BigFolder, type Insight, type PoolStats } from "../lib/insights";

const UploadSheet = lazy(() => import("./UploadSheet"));
const AutoUploadSheet = lazy(() => import("./AutoUploadSheet"));
const SortSheet = lazy(() => import("../components/SortSheet"));
const DownloadSheet = lazy(() => import("../components/DownloadSheet"));
const MoveSheet = lazy(() => import("../components/MoveSheet"));
const SearchSheet = lazy(() => import("../components/SearchSheet"));
const Viewer = lazy(() => import("../components/Viewer"));

const ROOT: Crumb = { name: "Drive", path: "", key: "" };
const STACK_KEY = "drivepool.stack";

function loadStack(): Crumb[] {
  try {
    const s = JSON.parse(sessionStorage.getItem(STACK_KEY) ?? "null");
    if (Array.isArray(s) && s.length > 0) return s as Crumb[];
  } catch {
    /* ignorieren */
  }
  return [ROOT];
}

const itemKey = (i: Item) => `${i.account_id}|${i.drive_id}`;

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Gute Nacht";
  if (h < 11) return "Guten Morgen";
  if (h < 18) return "Hallo";
  if (h < 22) return "Guten Abend";
  return "Gute Nacht";
}

type Direction = "forward" | "back" | "fade";

/** Ab dieser Zugweite (px) wird beim Loslassen aktualisiert */
const PULL_TRIGGER = 60;

export default function DriveView({ accounts }: { accounts: Account[] }) {
  const ui = useUI();
  const [stack, setStack] = useState<Crumb[]>(loadStack);
  const current = stack[stack.length - 1];
  const [direction, setDirection] = useState<Direction>("fade");
  const [content, setContent] = useState<FolderContent | null>(() => cachedFolder(current.key)?.content ?? null);
  const [error, setError] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewer, setViewer] = useState<number | null>(null);
  const [uploadFiles, setUploadFiles] = useState<File[] | null>(null);
  const [autoFiles, setAutoFiles] = useState<File[] | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [download, setDownload] = useState<{ items: Item[]; mode: "photos" | "zip"; title: string; basePath: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullStart = useRef<number | null>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(STACK_KEY, JSON.stringify(stack));
    } catch {
      /* ignorieren */
    }
  }, [stack]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  // Ordner laden: sofort aus dem Speicher, dann frisch vom Server
  useEffect(() => {
    let cancelled = false;
    const cached = cachedFolder(current.key);
    setContent(cached?.content ?? null);
    setError(null);
    setSelected(new Set());
    setSelectMode(false);

    loadFolder(current.key)
      .then((c) => {
        if (cancelled) return;
        setContent(c);
        // Unterordner im Hintergrund vorladen → Antippen öffnet sofort
        setTimeout(() => c.folders.slice(0, 12).forEach((f) => void prefetchFolder(f.key)), 400);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [current.key, tick]);

  const open = (f: LogicalFolder) => {
    setDirection("forward");
    setStack((s) => [...s, { name: f.name, path: f.path || childPath(s[s.length - 1].path, f.name), key: f.key }]);
    window.scrollTo({ top: 0 });
  };
  const openPath = (path: string) => {
    const segs = path.split("/");
    let key = "";
    let p = "";
    const crumbs: Crumb[] = [ROOT];
    for (const seg of segs) {
      key = childKey(key, seg);
      p = childPath(p, seg);
      crumbs.push({ name: seg, path: p, key });
    }
    setDirection("forward");
    setStack(crumbs);
    window.scrollTo({ top: 0 });
  };

  const goTo = (index: number) => {
    if (index === stack.length - 1) return;
    setDirection("back");
    setStack((s) => s.slice(0, index + 1));
    window.scrollTo({ top: 0 });
  };

  const syncAndReload = async (accountIds?: string[]) => {
    await syncAccounts(accountIds);
    invalidateAll();
    reload();
  };

  const newFolder = async () => {
    setMenuOpen(false);
    const name = await ui.prompt({
      title: "Neuer Ordner",
      message: current.path ? `in „${current.path}“` : "auf oberster Ebene",
      placeholder: "Name",
      validate: (v) =>
        validFolderName(v) ??
        (content?.folders.some((f) => f.name.toLowerCase() === v.toLowerCase()) ? `„${v}“ gibt es hier schon` : null),
    });
    if (!name) return;
    // Sofort anzeigen, im Hintergrund anlegen
    const optimistic: LogicalFolder = { key: childKey(current.key, name), name, path: childPath(current.path, name), parts: [] };
    const patch = (c: FolderContent) => ({ ...c, folders: [...c.folders, optimistic] });
    setContent((c) => (c ? patch(c) : c));
    patchFolder(current.key, patch);
    try {
      await createLogicalFolder(current, name, accounts);
      ui.toast(`Ordner „${name}“ erstellt`, "ok");
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      invalidateFolder(current.key);
      reload();
    }
  };

  const deleteFolder = async () => {
    setMenuOpen(false);
    if (stack.length < 2) return;
    const n = await countSubtreeFiles(current.path);
    const what = n === null ? "allen Fotos" : n === 0 ? "keinen Fotos" : `${n.toLocaleString("de-CH")} Foto${n === 1 ? "" : "s"}`;
    const ok = await ui.confirm({
      title: `„${current.name}“ löschen?`,
      message: `Der Ordner wird mit ${what} und allen Unterordnern in allen Konten in den Papierkorb verschoben. Wiederherstellen geht unter Mehr → Papierkorb (Google leert ihn nach 30 Tagen).`,
      confirmLabel: n && n >= 100 ? `${n.toLocaleString("de-CH")} Fotos löschen` : "Löschen",
      danger: true,
    });
    if (!ok) return;
    const folder = { key: current.key, name: current.name, path: current.path, parts: [] };
    const parentKey = stack[stack.length - 2].key;
    patchFolder(parentKey, (c) => ({ ...c, folders: c.folders.filter((f) => f.key !== folder.key) }));
    goTo(stack.length - 2);
    try {
      await trashLogicalFolder(folder);
      ui.toast(`„${folder.name}“ gelöscht`, "ok");
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      invalidateAll();
      reload();
    }
  };

  const refresh = async () => {
    setMenuOpen(false);
    setRefreshing(true);
    // 1. Sofort neu aus dem Index laden (schnell) …
    invalidateAll();
    reload();
    const spin = setTimeout(() => setRefreshing(false), 900);
    // 2. … und im Hintergrund mit Google abgleichen; bei Änderungen nochmals neu laden
    try {
      const results = await syncAccounts();
      const changed = results.reduce((s, r) => s + (r.changed ?? 0), 0);
      if (changed > 0) {
        invalidateAll();
        reload();
        ui.toast(`${changed.toLocaleString("de-CH")} Änderung${changed === 1 ? "" : "en"} übernommen`, "ok");
      }
      const failed = results.filter((r) => r.error);
      if (failed.length) ui.toast(`Abgleich fehlgeschlagen: ${failed.map((f) => f.email).join(", ")}`, "error");
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      clearTimeout(spin);
      setRefreshing(false);
    }
  };

  const files = useMemo(() => content?.files ?? [], [content]);
  const selectedItems = files.filter((f) => selected.has(itemKey(f)));

  const selectAll = () =>
    setSelected((s) => (s.size === files.length ? new Set() : new Set(files.map(itemKey))));

  const zipFolder = async () => {
    setMenuOpen(false);
    try {
      const items = await fetchSubtreeFiles(current.path);
      if (!items.length) return ui.toast("Keine Fotos in diesem Ordner", "info");
      setDownload({ items, mode: "zip", title: current.name, basePath: current.path });
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  // Gedrückt halten auf einem Ordner → Menü (Farbe, umbenennen, verschieben, ZIP, löschen)
  const [actionFolder, setActionFolder] = useState<LogicalFolder | null>(null);
  const zipOf = async (f: LogicalFolder) => {
    setActionFolder(null);
    try {
      const items = await fetchSubtreeFiles(f.path);
      if (!items.length) return ui.toast("Keine Fotos in diesem Ordner", "info");
      setDownload({ items, mode: "zip", title: f.name, basePath: f.path });
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    }
  };
  const deleteOf = async (f: LogicalFolder) => {
    setActionFolder(null);
    const n = await countSubtreeFiles(f.path);
    const what = n === null ? "allen Fotos" : n === 0 ? "keinen Fotos" : `${n.toLocaleString("de-CH")} Foto${n === 1 ? "" : "s"}`;
    const ok = await ui.confirm({
      title: `„${f.name}“ löschen?`,
      message: `Der Ordner wird mit ${what} und allen Unterordnern in allen Konten in den Papierkorb verschoben. Wiederherstellen geht unter Mehr → Papierkorb (Google leert ihn nach 30 Tagen).`,
      confirmLabel: n && n >= 100 ? `${n.toLocaleString("de-CH")} Fotos löschen` : "Löschen",
      danger: true,
    });
    if (!ok) return;
    patchFolder(current.key, (c) => ({ ...c, folders: c.folders.filter((x) => x.key !== f.key) }));
    setContent((c) => (c ? { ...c, folders: c.folders.filter((x) => x.key !== f.key) } : c));
    try {
      await trashLogicalFolder(f);
      ui.toast(`„${f.name}“ gelöscht`, "ok");
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      invalidateAll();
      reload();
    }
  };

  const deleteSelected = async () => {
    if (!selectedItems.length) return;
    const n = selectedItems.length;
    const ok = await ui.confirm({
      title: `${n} Foto${n === 1 ? "" : "s"} löschen?`,
      message: "Sie landen im Papierkorb des jeweiligen Google-Kontos.",
      confirmLabel: "Löschen",
      danger: true,
    });
    if (!ok) return;
    const gone = new Set(selectedItems.map(itemKey));
    const patch = (c: FolderContent) => ({ ...c, files: c.files.filter((f) => !gone.has(itemKey(f))) });
    setContent((c) => (c ? patch(c) : c));
    patchFolder(current.key, patch);
    setSelectMode(false);
    setSelected(new Set());
    ui.toast(`${n} Foto${n === 1 ? "" : "s"} gelöscht`, "ok");
    trashFiles(selectedItems)
      .then((r) => {
        if (r.failed.length) ui.toast(`Nicht gelöscht: ${r.failed.length}`, "error");
      })
      .catch((e) => ui.toast(e instanceof Error ? e.message : String(e), "error"))
      .finally(() => {
        invalidateFolder(current.key);
        reload();
      });
  };

  const renameLegacyArea = async (folder: LogicalFolder) => {
    const ok = await ui.confirm({
      title: "„Schule“ in „Archiv“ umbenennen?",
      message: `Der Ordner wird in ${folder.parts.length} Konto/Konten umbenannt. Inhalt und Fotos bleiben unverändert.`,
      confirmLabel: "Umbenennen",
    });
    if (!ok) return;
    try {
      for (const p of folder.parts) await renameItem(p.account_id, p.drive_id, "Archiv");
      await writeLog("rename", "„Schule“ → „Archiv“ (Bereich umbenannt)", { konten: folder.parts.length });
      await movePathPrefs("schule", "archiv").catch(() => undefined);
      await syncAndReload([...new Set(folder.parts.map((p) => p.account_id))]);
      ui.toast("„Archiv“ ist bereit", "ok");
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const toggle = (f: Item) =>
    setSelected((s) => {
      const n = new Set(s);
      const k = itemKey(f);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  // Ziehen zum Aktualisieren
  const onTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY <= 0 && !refreshing && viewer === null && !uploadFiles) pullStart.current = e.touches[0].clientY;
  };
  const pullRef = useRef(0);
  const onTouchMove = (e: React.TouchEvent) => {
    if (pullStart.current === null) return;
    const d = e.touches[0].clientY - pullStart.current;
    if (d > 0 && window.scrollY <= 0) {
      pullRef.current = Math.min(d * 0.5, 110);
      setPull(pullRef.current);
    } else {
      pullStart.current = null;
      pullRef.current = 0;
      setPull(0);
    }
  };
  const onTouchEnd = () => {
    if (pullStart.current !== null && pullRef.current >= PULL_TRIGGER) void refresh();
    pullStart.current = null;
    pullRef.current = 0;
    setPull(0);
  };

  const isRoot = stack.length === 1;
  const pageClass = direction === "forward" ? "page-forward" : direction === "back" ? "page-back" : "page-fade";

  return (
    <div className="view" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <div
        className={`ptr ${refreshing ? "spinning" : ""} ${pull ? "dragging" : ""} ${pull >= PULL_TRIGGER ? "armed" : ""}`}
        style={{ ["--pull" as string]: `${refreshing ? 64 : pull}px` }}
        aria-hidden={!refreshing && !pull}
      >
        <div className="ptr-inner" style={{ transform: refreshing ? undefined : `rotate(${pull * 4}deg)` }}>
          <Icon name="refresh" size={20} />
        </div>
      </div>

      {isRoot ? (
        <Topbar
          eyebrow={greeting()}
          title={<span className="grad-text">Dein Drive</span>}
          right={
            <>
              <button className="icon-btn" onClick={() => setSearchOpen(true)} aria-label="Suchen">
                <Icon name="search" />
              </button>
              <button className="icon-btn" onClick={() => setMenuOpen((m) => !m)} aria-label="Menü">
                <Icon name="more" />
              </button>
            </>
          }
        >
        </Topbar>
      ) : (
        <Topbar
          eyebrow={stack.length > 2 ? stack[stack.length - 2].name : "Drive"}
          title={current.name}
          left={
            <button className="icon-btn" onClick={() => goTo(stack.length - 2)} aria-label="Zurück">
              <Icon name="chevronLeft" />
            </button>
          }
          right={
            <>
              {files.length > 0 && (
                <button
                  className={`icon-btn ${selectMode ? "on" : ""}`}
                  onClick={() => {
                    setSelectMode((m) => !m);
                    setSelected(new Set());
                  }}
                  aria-label="Auswählen"
                >
                  <Icon name="checkCircle" />
                </button>
              )}
              <button className="icon-btn" onClick={() => setMenuOpen((m) => !m)} aria-label="Menü">
                <Icon name="more" />
              </button>
            </>
          }
        >
          {stack.length > 2 && (
            <div className="crumbs">
              {stack.map((c, i) => (
                <button key={c.key + i} className={`crumb ${i === stack.length - 1 ? "current" : ""}`} onClick={() => goTo(i)}>
                  {i === 0 ? <Icon name="grid" size={13} /> : null}
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </Topbar>
      )}

      {menuOpen && (
        <Menu
          onNewFolder={newFolder}
          onRefresh={refresh}
          onZip={isRoot ? undefined : zipFolder}
          onDelete={isRoot ? undefined : deleteFolder}
          onClose={() => setMenuOpen(false)}
        />
      )}

      {error && (
        <div className="banner error" onClick={() => setError(null)}>
          <Icon name="alert" size={18} />
          {error}
        </div>
      )}

      <div key={current.key} className={pageClass}>
        {isRoot ? (
          <RootContent
            accounts={accounts}
            content={content}
            onOpen={open}
            onOpenPath={openPath}
            onRenameLegacy={renameLegacyArea}
            onLongPress={setActionFolder}
          />
        ) : (
          <>
            {!content ? (
              <>
                <FolderSkeleton count={2} />
                <GridSkeleton />
              </>
            ) : (
              <>
                {content.folders.length > 0 && <FolderGrid folders={content.folders} onOpen={open} onLongPress={setActionFolder} />}
                {files.length > 0 && (
                  <>
                    {content.folders.length > 0 && (
                      <div className="section-title">
                        <span>Fotos</span>
                        <span>{files.length}</span>
                      </div>
                    )}
                    <div className="grid stagger">
                      {files.map((f, i) => (
                        <button
                          key={itemKey(f)}
                          className={`cell ${selected.has(itemKey(f)) ? "selected" : ""}`}
                          style={{ ["--i" as string]: i }}
                          onClick={() => (selectMode ? toggle(f) : setViewer(i))}
                        >
                          <Thumb item={f} />
                          {selectMode && (
                            <span className={`check ${selected.has(itemKey(f)) ? "on" : ""}`}>
                              {selected.has(itemKey(f)) && <Icon name="check" size={15} />}
                            </span>
                          )}
                          <span className="cell-name">{f.name}</span>
                          {f.mime_type?.startsWith("video/") && (
                            <span className="cell-play">
                              <Icon name="play" size={14} />
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {content.folders.length === 0 && files.length === 0 && (
                  <div className="empty">
                    <div className="empty-icon">
                      <Icon name="image" size={32} />
                    </div>
                    <strong>Noch leer</strong>
                    <span>Tippe auf „Hochladen“, um Fotos hinzuzufügen.</span>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {selectMode ? (
        <div className="actionbar glass">
          <span>
            <b>{selected.size}</b>
            <button className="link small" style={{ marginLeft: 8 }} onClick={selectAll}>
              {selected.size === files.length ? "Keine" : "Alle"}
            </button>
          </span>
          <div className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
            <button className="btn small" disabled={!selected.size} onClick={() => setMoveOpen(true)} aria-label="Verschieben">
              <Icon name="move" size={17} />
            </button>
            <button className="btn small" disabled={!selected.size} onClick={() => setSortOpen(true)} aria-label="Sortieren">
              <Icon name="sortNum" size={17} />
            </button>
            <button
              className="btn small"
              disabled={!selected.size}
              onClick={() => setDownload({ items: selectedItems, mode: "photos", title: current.name, basePath: current.path })}
              aria-label="Sichern"
            >
              <Icon name="download" size={17} />
            </button>
            <button className="btn small danger-solid" disabled={!selected.size} onClick={deleteSelected} aria-label="Löschen">
              <Icon name="trash" size={17} />
            </button>
          </div>
        </div>
      ) : isRoot ? (
        accounts.length > 0 && (
          <label className="fab">
            <Icon name="upload" size={20} /> Fotos sichern
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              hidden
              onChange={(e) => {
                const list = e.target.files ? [...e.target.files] : [];
                e.target.value = "";
                if (list.length) setAutoFiles(list);
              }}
            />
          </label>
        )
      ) : (
        (
          <label className="fab">
            <Icon name="upload" size={20} /> Hochladen
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              hidden
              onChange={(e) => {
                const list = e.target.files ? [...e.target.files] : [];
                e.target.value = "";
                if (list.length) setUploadFiles(list);
              }}
            />
          </label>
        )
      )}

      <Suspense fallback={null}>
        {viewer !== null && files[viewer] && (
          <Viewer
            items={files}
            index={viewer}
            accounts={accounts}
            onIndex={setViewer}
            onClose={() => setViewer(null)}
          />
        )}

        {uploadFiles && content && (
          <UploadSheet
            files={uploadFiles}
            target={current}
            content={content}
            accounts={accounts}
            onClose={(changed) => {
              setUploadFiles(null);
              if (changed) {
                invalidateFolder(current.key);
                reload();
              }
            }}
          />
        )}
        {autoFiles && (
          <AutoUploadSheet
            files={autoFiles}
            accounts={accounts}
            onClose={(changed) => {
              setAutoFiles(null);
              if (changed) {
                invalidateAll();
                reload();
              }
            }}
          />
        )}

        {sortOpen && content && (
          <SortSheet
            selected={selectedItems}
            folderFiles={content.files}
            folderPath={current.path}
            onClose={(changed) => {
              setSortOpen(false);
              if (changed) {
                setSelectMode(false);
                setSelected(new Set());
                invalidateFolder(current.key);
                reload();
              }
            }}
          />
        )}

        {actionFolder && (
        <FolderActions
          folder={actionFolder}
          accounts={accounts}
          protectedFolder={isRoot && AREA_KEYS.has(actionFolder.key)}
          onOpen={() => {
            const f = actionFolder;
            setActionFolder(null);
            open(f);
          }}
          onZip={() => zipOf(actionFolder)}
          onDelete={() => deleteOf(actionFolder)}
          onChanged={() => {
            invalidateAll();
            reload();
          }}
          onClose={() => setActionFolder(null)}
        />
      )}
      {moveOpen && (
          <MoveSheet
            items={selectedItems}
            accounts={accounts}
            onClose={(changed) => {
              setMoveOpen(false);
              if (changed) {
                setSelectMode(false);
                setSelected(new Set());
                invalidateFolder(current.key);
                reload();
              }
            }}
          />
        )}

        {searchOpen && <SearchSheet accounts={accounts} onOpenPath={openPath} onClose={() => setSearchOpen(false)} />}

        {download && (
          <DownloadSheet
            items={download.items}
            mode={download.mode}
            title={download.title}
            basePath={download.basePath}
            onClose={() => setDownload(null)}
          />
        )}
      </Suspense>
    </div>
  );
}

function Menu({
  onNewFolder,
  onRefresh,
  onZip,
  onDelete,
  onClose,
}: {
  onNewFolder: () => void;
  onRefresh: () => void;
  onZip?: () => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="menu-backdrop" onClick={onClose} />
      <div className="menu glass">
        <button onClick={onNewFolder}>
          <Icon name="folderPlus" size={20} /> Neuer Ordner
        </button>
        <button onClick={onRefresh}>
          <Icon name="refresh" size={20} /> Synchronisieren
        </button>
        {onZip && (
          <button onClick={onZip}>
            <Icon name="download" size={20} /> Ordner als ZIP sichern
          </button>
        )}
        {onDelete && (
          <button className="danger" onClick={onDelete}>
            <Icon name="trash" size={20} /> Ordner löschen
          </button>
        )}
      </div>
    </>
  );
}

function FolderGrid({
  folders,
  onOpen,
  onLongPress,
}: {
  folders: LogicalFolder[];
  onOpen: (f: LogicalFolder) => void;
  onLongPress?: (f: LogicalFolder) => void;
}) {
  useFolderColors();
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <div className="folders stagger">
      {folders.map((f, i) => (
        <button
          key={f.key}
          className={`folder ${f.parts.length === 0 ? "pending" : ""}`}
          style={{ ["--i" as string]: i, ["--h" as string]: hueOf(f.key, f.name) }}
          onPointerDown={(e) => {
            void prefetchFolder(f.key).then((c) => c && warmThumbs(c.files));
            if (!onLongPress || f.parts.length === 0) return;
            fired.current = false;
            start.current = { x: e.clientX, y: e.clientY };
            const el = e.currentTarget;
            cancel();
            timer.current = window.setTimeout(() => {
              fired.current = true;
              haptic();
              el.classList.add("pressed");
              setTimeout(() => el.classList.remove("pressed"), 250);
              onLongPress(f);
            }, 480);
          }}
          onPointerMove={(e) => {
            if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel();
          }}
          onPointerUp={cancel}
          onTouchEnd={(e) => {
            // Nach dem Gedrückthalten keinen „Klick“ auslösen (der würde im geöffneten Menü landen)
            if (fired.current) e.preventDefault();
          }}
          onPointerCancel={cancel}
          onPointerLeave={cancel}
          onContextMenu={(e) => {
            // Rechtsklick (Desktop) bzw. iOS-Kontextmenü → eigenes Menü
            e.preventDefault();
            if (onLongPress && !fired.current && f.parts.length) onLongPress(f);
          }}
          onClick={() => {
            if (fired.current) {
              fired.current = false;
              return;
            }
            onOpen(f);
          }}
        >
          <span className="folder-icon">
            <Icon name="folder" size={20} />
          </span>
          <span style={{ minWidth: 0 }}>
            <div className="folder-name">{f.name}</div>
            {f.parts.length === 0 ? (
              <div className="folder-meta">wird erstellt …</div>
            ) : f.parts.length > 1 ? (
              <div className="folder-meta">{f.parts.length} Konten</div>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}

// Hinweise (Regel 4, 9, 10) – Kennzahlen werden kurz zwischengespeichert
let insightCache: { at: number; stats: PoolStats; big: BigFolder[] } | null = null;

function useInsights(accounts: Account[]): Insight[] {
  const [data, setData] = useState(insightCache);
  useEffect(() => {
    if (insightCache && Date.now() - insightCache.at < 60_000) return;
    Promise.all([fetchStats(), fetchBigFolders(13.5 * 1024 ** 3)])
      .then(([stats, big]) => {
        insightCache = { at: Date.now(), stats, big };
        setData(insightCache);
      })
      .catch(() => undefined);
  }, [accounts]);
  // Rebalancing (Regel 6): Vorschlag bzw. laufende Ausführung als Hinweis
  const [reb, setReb] = useState<Insight | null>(null);
  useEffect(() => {
    if (accounts.filter((a) => a.status === "active").length < 2) return;
    loadRebalance(accounts)
      .then((r) => {
        if (r.active) {
          setReb({ id: "rebalance", level: "info", title: "Rebalancing läuft", text: `${r.active.done} von ${r.active.total || "…"} Fotos verschoben – antippen für Details.`, action: { kind: "route", to: "regal" } });
        } else if (r.plan.steps.length && !r.rejected) {
          const fresh = accounts.some((a) => Date.now() - Date.parse(a.created_at) < 7 * 864e5);
          setReb({
            id: "rebalance",
            level: "info",
            title: fresh ? "Neues Konto – Rebalancing-Vorschlag bereit" : "Rebalancing-Vorschlag bereit",
            text: `${r.plan.steps.length} Ordner, ${formatBytes(r.plan.bytes)} – antippen zum Ansehen.`,
            action: { kind: "route", to: "regal" },
          });
        } else setReb(null);
      })
      .catch(() => undefined);
  }, [accounts]);
  return useMemo(() => [...computeInsights(accounts, data?.stats ?? null, data?.big ?? []), ...(reb ? [reb] : [])], [accounts, data, reb]);
}

const INSIGHT_ICON = { crit: "alert", warn: "alert", info: "info" } as const;

function Insights({ items, onOpenPath }: { items: Insight[]; onOpenPath: (path: string) => void }) {
  if (!items.length) return null;
  return (
    <>
      <div className="section-title">
        <span>Hinweise</span>
      </div>
      <div className="insights stagger">
        {items.map((it, i) => (
          <button
            key={it.id}
            className={`insight glass ${it.level}`}
            style={{ ["--i" as string]: i }}
            onClick={() => {
              if (!it.action) return;
              if (it.action.kind === "route") navigate(it.action.to);
              else onOpenPath(it.action.path);
            }}
          >
            <span className="insight-icon">
              <Icon name={it.id === "forecast" ? "chart" : it.id === "dup" ? "copy" : INSIGHT_ICON[it.level]} size={18} />
            </span>
            <span className="insight-text">
              <strong>{it.title}</strong>
              <span>{it.text}</span>
            </span>
            {it.action && <Icon name="chevronRight" size={16} className="faint" />}
          </button>
        ))}
      </div>
    </>
  );
}

function RootContent({
  accounts,
  content,
  onOpen,
  onOpenPath,
  onRenameLegacy,
  onLongPress,
}: {
  accounts: Account[];
  content: FolderContent | null;
  onOpen: (f: LogicalFolder) => void;
  onOpenPath: (path: string) => void;
  onRenameLegacy: (f: LogicalFolder) => void;
  onLongPress: (f: LogicalFolder) => void;
}) {
  const insights = useInsights(accounts);
  const active = accounts.filter((a) => a.status === "active");
  const total = active.reduce((s, a) => s + (a.quota_limit ?? 0), 0);
  const used = active.reduce((s, a) => s + (a.quota_usage ?? 0), 0);
  const free = useCountUp(Math.max(0, total - used) / 1024 ** 3);
  const segments = accounts
    .map((a, i) => ({ value: a.status === "active" ? a.quota_usage ?? 0 : 0, color: accountColor(i), label: a.email }))
    .filter((s) => s.value > 0);

  const folders = content?.folders ?? [];
  const archiv = folders.find((f) => f.key === "archiv");
  const legacy = folders.find((f) => f.key === "schule");
  const privat = folders.find((f) => f.key === "privat");
  const others = folders.filter((f) => !AREA_KEYS.has(f.key));
  const roleCount = (r: string) => accounts.filter((a) => a.role === r).length;
  // Privat ist abgeschottet → freier Platz pro Gebiet zählt mehr als der ganze Pool
  const roleFree = (r: string) =>
    active.filter((a) => a.role === r).reduce((s, a) => s + Math.max(0, (a.quota_limit ?? 0) - (a.quota_usage ?? 0)), 0);
  const areaLine = (r: string) =>
    `${roleCount(r)} ${roleCount(r) === 1 ? "Konto" : "Konten"} · ${formatBytes(roleFree(r))} frei`;

  if (accounts.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon">
          <Icon name="cloud" size={34} />
        </div>
        <strong>Noch kein Konto verbunden</strong>
        <span>Verbinde dein erstes Google-Konto, um loszulegen.</span>
        <button className="btn primary" onClick={() => navigate("konten")}>
          <Icon name="plus" size={18} /> Konto verbinden
        </button>
      </div>
    );
  }

  return (
    <>
      <section className="card glass enter">
        <div className="hero">
          <Donut segments={segments} total={total} />
          <div className="hero-info">
            <div className="muted small">Frei im Pool</div>
            <div className="hero-big">
              {free.toFixed(1)} <span className="muted" style={{ fontSize: "1rem" }}>GB</span>
            </div>
            <div className="muted small">
              von {formatBytes(total)} · {active.length} {active.length === 1 ? "Konto" : "Konten"}
            </div>
            <div className="legend">
              {accounts.map((a, i) => (
                <div key={a.id} className="legend-row">
                  <span className="dot" style={{ background: accountColor(i), color: accountColor(i) }} />
                  <span className="ellipsis">{a.email}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <Insights items={insights} onOpenPath={onOpenPath} />

      {legacy && !archiv && (
        <button className="banner pressable" onClick={() => onRenameLegacy(legacy)}>
          <Icon name="sparkles" size={18} />
          <span>„Schule“ heisst jetzt „Archiv“ – antippen zum Umbenennen</span>
        </button>
      )}

      {!content ? (
        <FolderSkeleton count={2} />
      ) : (
        <div className="areas stagger">
          {(archiv ?? legacy) && (
            <button className="area-card archiv" style={{ ["--i" as string]: 0 }} onClick={() => onOpen((archiv ?? legacy)!)}>
              <span className="area-icon">
                <Icon name="archive" />
              </span>
              <span>
                <strong>Archiv</strong>
                <br />
                <span>{areaLine("schule")}</span>
              </span>
            </button>
          )}
          {privat && (
            <button className="area-card privat" style={{ ["--i" as string]: 1 }} onClick={() => onOpen(privat)}>
              <span className="area-icon">
                <Icon name="lock" />
              </span>
              <span>
                <strong>Privat</strong>
                <br />
                <span>{areaLine("privat")}</span>
              </span>
            </button>
          )}
        </div>
      )}

      {others.length > 0 && (
        <>
          <div className="section-title">
            <span>Nicht eingeordnet</span>
            <button className="link small" onClick={() => navigate("einrichtung")}>
              Einordnen
            </button>
          </div>
          <FolderGrid folders={others} onOpen={onOpen} onLongPress={onLongPress} />
        </>
      )}

      {content && !archiv && !legacy && !privat && others.length === 0 && (
        <div className="empty">
          <div className="empty-icon">
            <Icon name="refresh" size={30} />
          </div>
          <strong>Noch nichts eingelesen</strong>
          <span>Ziehe nach unten oder tippe auf ⋯ → Synchronisieren.</span>
        </div>
      )}
    </>
  );
}
