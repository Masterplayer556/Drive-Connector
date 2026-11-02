import { useCallback, useEffect, useMemo, useState } from "react";
import StorageBar from "../components/StorageBar";
import Thumb from "../components/Thumb";
import Viewer from "../components/Viewer";
import { fetchFolder, syncAccounts } from "../lib/db";
import { createLogicalFolder, trashFiles, trashLogicalFolder } from "../lib/folders";
import { listThumbnails } from "../lib/google";
import { childKey, childPath, validFolderName } from "../lib/naming";
import { navigate } from "../lib/route";
import type { Account, Crumb, FolderContent, Item } from "../lib/types";
import UploadSheet from "./UploadSheet";

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

export default function DriveView({ accounts }: { accounts: Account[] }) {
  const [stack, setStack] = useState<Crumb[]>(loadStack);
  const current = stack[stack.length - 1];
  const [content, setContent] = useState<FolderContent | null>(null);
  const [links, setLinks] = useState<Map<string, string>>(new Map());
  const [linksReady, setLinksReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewer, setViewer] = useState<number | null>(null);
  const [uploadFiles, setUploadFiles] = useState<File[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    try {
      sessionStorage.setItem(STACK_KEY, JSON.stringify(stack));
    } catch {
      /* ignorieren */
    }
  }, [stack]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelected(new Set());
    setSelectMode(false);
    fetchFolder(current.key)
      .then(async (c) => {
        if (cancelled) return;
        setContent(c);
        setLoading(false);
        setLinksReady(false);
        // Vorschau-Links pro physischem Ordner laden
        const groups = new Map<string, { accountId: string; folderId: string }>();
        for (const f of c.files) {
          if (f.parent_drive_id) groups.set(`${f.account_id}|${f.parent_drive_id}`, { accountId: f.account_id, folderId: f.parent_drive_id });
        }
        const merged = new Map<string, string>();
        await Promise.all(
          [...groups.values()].map((g) =>
            listThumbnails(g.accountId, g.folderId)
              .then((m) => m.forEach((v, k) => merged.set(k, v)))
              .catch(() => undefined),
          ),
        );
        if (!cancelled) {
          setLinks(merged);
          setLinksReady(true);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [current.key, tick]);

  const open = (name: string, path: string) => {
    setLinks(new Map());
    setContent(null);
    setStack((s) => [...s, { name, path, key: childKey(s[s.length - 1].key, name) }]);
  };
  const goTo = (index: number) => {
    setLinks(new Map());
    setContent(null);
    setStack((s) => s.slice(0, index + 1));
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      reload();
    }
  };

  const newFolder = () => {
    setMenuOpen(false);
    const name = window.prompt("Name des neuen Ordners")?.trim();
    if (!name) return;
    const invalid = validFolderName(name);
    if (invalid) return setError(invalid);
    if (content?.folders.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      return setError(`Ordner „${name}“ gibt es hier schon`);
    }
    void run("Ordner wird erstellt …", async () => {
      await createLogicalFolder(current, name, accounts);
    });
  };

  const deleteFolder = () => {
    setMenuOpen(false);
    const parent = stack[stack.length - 2];
    if (!parent) return;
    const ok = window.confirm(
      `Ordner „${current.name}“ mit allen Fotos und Unterordnern in den Papierkorb verschieben (in allen Konten)?`,
    );
    if (!ok) return;
    void run("Ordner wird gelöscht …", async () => {
      await trashLogicalFolder({ key: current.key, name: current.name, path: current.path, parts: [] });
      goTo(stack.length - 2);
    });
  };

  const refresh = () => {
    setMenuOpen(false);
    void run("Synchronisiere …", async () => {
      await syncAccounts();
    });
  };

  const files = useMemo(() => content?.files ?? [], [content]);
  const selectedItems = files.filter((f) => selected.has(itemKey(f)));

  const deleteSelected = () => {
    if (!selectedItems.length) return;
    if (!window.confirm(`${selectedItems.length} Foto(s) in den Papierkorb verschieben?`)) return;
    void run("Wird gelöscht …", async () => {
      const r = await trashFiles(selectedItems);
      if (r.failed.length) setError(`Nicht gelöscht: ${r.failed.join("; ")}`);
    });
  };

  const toggle = (f: Item) =>
    setSelected((s) => {
      const n = new Set(s);
      const k = itemKey(f);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const isRoot = stack.length === 1;
  const activeAccounts = accounts.filter((a) => a.status === "active");
  const total = activeAccounts.reduce((s, a) => s + (a.quota_limit ?? 0), 0);
  const used = activeAccounts.reduce((s, a) => s + (a.quota_usage ?? 0), 0);
  const needsSetup =
    isRoot && content && content.folders.some((f) => f.key !== "schule" && f.key !== "privat");

  return (
    <div className="view">
      <header className="header">
        <div className="crumbs">
          {stack.map((c, i) => (
            <span key={c.key + i}>
              {i > 0 && <span className="muted"> / </span>}
              <button className="crumb" disabled={i === stack.length - 1} onClick={() => goTo(i)}>
                {c.name}
              </button>
            </span>
          ))}
        </div>
        <div className="header-actions">
          {!isRoot && files.length > 0 && (
            <button
              className="btn small"
              onClick={() => {
                setSelectMode((m) => !m);
                setSelected(new Set());
              }}
            >
              {selectMode ? "Fertig" : "Auswählen"}
            </button>
          )}
          <button className="btn small" onClick={() => setMenuOpen((m) => !m)} aria-label="Menü">
            ⋯
          </button>
        </div>
      </header>

      {menuOpen && (
        <div className="menu">
          <button onClick={newFolder}>📁 Neuer Ordner</button>
          <button onClick={refresh}>🔄 Synchronisieren</button>
          {!isRoot && (
            <button className="danger" onClick={deleteFolder}>
              🗑️ Ordner löschen
            </button>
          )}
        </div>
      )}

      {isRoot && (
        <section className="card">
          {accounts.length === 0 ? (
            <div className="stack">
              <p>Noch kein Google-Konto verbunden.</p>
              <button className="btn primary" onClick={() => navigate("konten")}>
                Konto verbinden
              </button>
            </div>
          ) : (
            <StorageBar used={used} total={total} label={`${activeAccounts.length} Konten im Pool`} />
          )}
        </section>
      )}

      {needsSetup && (
        <button className="banner" onClick={() => navigate("einrichtung")}>
          Einige Ordner liegen noch nicht unter „Schule“ oder „Privat“ – Einrichtung öffnen
        </button>
      )}

      {error && (
        <div className="banner error" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {busy && <div className="banner">{busy}</div>}

      {loading && !content ? (
        <p className="muted pad">Lädt …</p>
      ) : (
        <>
          {content && content.folders.length > 0 && (
            <div className="folders">
              {content.folders.map((f) => (
                <button key={f.key} className="folder" onClick={() => open(f.name, f.path || childPath(current.path, f.name))}>
                  <span className="folder-icon">📁</span>
                  <span className="folder-name">{f.name}</span>
                  {f.parts.length > 1 && <span className="folder-badge">{f.parts.length} Konten</span>}
                </button>
              ))}
            </div>
          )}

          {files.length > 0 && (
            <div className="grid">
              {files.map((f, i) => (
                <button
                  key={itemKey(f)}
                  className={`cell ${selected.has(itemKey(f)) ? "selected" : ""}`}
                  onClick={() => (selectMode ? toggle(f) : setViewer(i))}
                >
                  <Thumb item={f} link={links.get(f.drive_id)} ready={linksReady} />
                  <span className="cell-name">{f.name}</span>
                  {selectMode && <span className="check">{selected.has(itemKey(f)) ? "✓" : ""}</span>}
                </button>
              ))}
            </div>
          )}

          {content && content.folders.length === 0 && files.length === 0 && accounts.length > 0 && (
            <p className="muted pad">
              {isRoot ? "Noch nichts da. Tippe auf „⋯ → Synchronisieren“." : "Dieser Ordner ist leer."}
            </p>
          )}
        </>
      )}

      {selectMode ? (
        <div className="actionbar">
          <span>{selected.size} ausgewählt</span>
          <button className="btn danger" disabled={!selected.size} onClick={deleteSelected}>
            Löschen
          </button>
        </div>
      ) : (
        !isRoot && (
          <label className="fab">
            ⬆︎ Hochladen
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
            if (changed) reload();
          }}
        />
      )}
    </div>
  );
}
