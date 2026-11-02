import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Donut from "../components/Donut";
import Icon from "../components/Icon";
import { FolderSkeleton, GridSkeleton } from "../components/Skeleton";
import Thumb from "../components/Thumb";
import Topbar from "../components/Topbar";
import { useUI } from "../components/ui";
import { AREA_KEYS } from "../lib/areas";
import { cachedFolder, invalidateAll, invalidateFolder, loadFolder, loadLinks, patchFolder, prefetchFolder } from "../lib/cache";
import { syncAccounts, writeLog } from "../lib/db";
import { createLogicalFolder, trashFiles, trashLogicalFolder } from "../lib/folders";
import { formatBytes } from "../lib/format";
import { renameItem } from "../lib/google";
import { childKey, childPath, validFolderName } from "../lib/naming";
import { navigate } from "../lib/route";
import { accountColor, folderHue } from "../lib/theme";
import type { Account, Crumb, FolderContent, Item, LogicalFolder } from "../lib/types";
import { useCountUp } from "../lib/useCountUp";

const UploadSheet = lazy(() => import("./UploadSheet"));
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

export default function DriveView({ accounts }: { accounts: Account[] }) {
  const ui = useUI();
  const [stack, setStack] = useState<Crumb[]>(loadStack);
  const current = stack[stack.length - 1];
  const [direction, setDirection] = useState<Direction>("fade");
  const [content, setContent] = useState<FolderContent | null>(() => cachedFolder(current.key)?.content ?? null);
  const [links, setLinks] = useState<Map<string, string>>(() => cachedFolder(current.key)?.links ?? new Map());
  const [linksReady, setLinksReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewer, setViewer] = useState<number | null>(null);
  const [uploadFiles, setUploadFiles] = useState<File[] | null>(null);
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
    setLinks(cached?.links ?? new Map());
    setLinksReady(false);
    setError(null);
    setSelected(new Set());
    setSelectMode(false);

    loadFolder(current.key)
      .then(async (c) => {
        if (cancelled) return;
        setContent(c);
        // Unterordner im Hintergrund vorladen → Antippen öffnet sofort
        setTimeout(() => c.folders.slice(0, 12).forEach((f) => prefetchFolder(f.key)), 400);
        const l = await loadLinks(current.key, c);
        if (!cancelled) {
          setLinks(l);
          setLinksReady(true);
        }
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
    const ok = await ui.confirm({
      title: `„${current.name}“ löschen?`,
      message: "Der Ordner wird mit allen Fotos und Unterordnern in allen Konten in den Papierkorb verschoben.",
      confirmLabel: "Löschen",
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
    try {
      await syncAndReload();
      ui.toast("Alles aktuell", "ok");
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setRefreshing(false);
    }
  };

  const files = useMemo(() => content?.files ?? [], [content]);
  const selectedItems = files.filter((f) => selected.has(itemKey(f)));

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
  const onTouchMove = (e: React.TouchEvent) => {
    if (pullStart.current === null) return;
    const d = e.touches[0].clientY - pullStart.current;
    if (d > 0) setPull(Math.min(d * 0.45, 90));
    else {
      pullStart.current = null;
      setPull(0);
    }
  };
  const onTouchEnd = () => {
    if (pull > 58) void refresh();
    pullStart.current = null;
    setPull(0);
  };

  const isRoot = stack.length === 1;
  const pageClass = direction === "forward" ? "page-forward" : direction === "back" ? "page-back" : "page-fade";

  return (
    <div className="view" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <div className="ptr" style={{ height: refreshing ? 52 : pull }}>
        <div
          className={`ptr-inner ${refreshing ? "spinning" : ""}`}
          style={{ transform: refreshing ? undefined : `rotate(${pull * 4}deg) scale(${Math.min(1, pull / 58)})` }}
        >
          <Icon name="refresh" size={20} />
        </div>
      </div>

      {isRoot ? (
        <Topbar
          eyebrow={greeting()}
          title={<span className="grad-text">Dein Drive</span>}
          right={
            <button className="icon-btn" onClick={() => setMenuOpen((m) => !m)} aria-label="Menü">
              <Icon name="more" />
            </button>
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
            onRenameLegacy={renameLegacyArea}
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
                {content.folders.length > 0 && <FolderGrid folders={content.folders} onOpen={open} />}
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
                          <Thumb item={f} link={links.get(f.drive_id)} ready={linksReady} />
                          {selectMode && (
                            <span className={`check ${selected.has(itemKey(f)) ? "on" : ""}`}>
                              {selected.has(itemKey(f)) && <Icon name="check" size={15} />}
                            </span>
                          )}
                          <span className="cell-name">{f.name}</span>
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
            <b>{selected.size}</b> ausgewählt
          </span>
          <button className="btn small danger-solid" disabled={!selected.size} onClick={deleteSelected}>
            <Icon name="trash" size={17} /> Löschen
          </button>
        </div>
      ) : (
        !isRoot && (
          <label className="fab">
            <Icon name="upload" size={20} /> Hochladen
            <input
              type="file"
              accept="image/*"
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
            links={links}
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
      </Suspense>
    </div>
  );
}

function Menu({
  onNewFolder,
  onRefresh,
  onDelete,
  onClose,
}: {
  onNewFolder: () => void;
  onRefresh: () => void;
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
        {onDelete && (
          <button className="danger" onClick={onDelete}>
            <Icon name="trash" size={20} /> Ordner löschen
          </button>
        )}
      </div>
    </>
  );
}

function FolderGrid({ folders, onOpen }: { folders: LogicalFolder[]; onOpen: (f: LogicalFolder) => void }) {
  return (
    <div className="folders stagger">
      {folders.map((f, i) => (
        <button
          key={f.key}
          className={`folder ${f.parts.length === 0 ? "pending" : ""}`}
          style={{ ["--i" as string]: i, ["--h" as string]: folderHue(f.name) }}
          onPointerDown={() => prefetchFolder(f.key)}
          onClick={() => onOpen(f)}
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

function RootContent({
  accounts,
  content,
  onOpen,
  onRenameLegacy,
}: {
  accounts: Account[];
  content: FolderContent | null;
  onOpen: (f: LogicalFolder) => void;
  onRenameLegacy: (f: LogicalFolder) => void;
}) {
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
                <span>{roleCount("schule")} {roleCount("schule") === 1 ? "Konto" : "Konten"}</span>
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
                <span>{roleCount("privat")} {roleCount("privat") === 1 ? "Konto" : "Konten"}</span>
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
          <FolderGrid folders={others} onOpen={onOpen} />
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
