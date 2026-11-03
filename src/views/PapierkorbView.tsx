import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import Ring from "../components/Ring";
import { GridSkeleton } from "../components/Skeleton";
import Thumb from "../components/Thumb";
import Topbar from "../components/Topbar";
import { useUI } from "../components/ui";
import { invalidateAll } from "../lib/cache";
import { fetchSettings, saveSettings, syncAccounts, writeLog } from "../lib/db";
import { formatBytes, formatDateTime } from "../lib/format";
import { deleteForever, emptyTrash, getQuota, restoreItem } from "../lib/google";
import { navigate } from "../lib/route";
import { accountColor, folderHue } from "../lib/theme";
import { loadTrash, purgeOlderThan, trashEntryItem, type TrashEntry } from "../lib/trash";
import type { Account } from "../lib/types";

const key = (e: TrashEntry) => `${e.account.id}|${e.file.id}`;
const AUTO_OPTIONS: { days: number | null; label: string }[] = [
  { days: null, label: "Aus" },
  { days: 7, label: "7 Tage" },
  { days: 30, label: "30 Tage" },
  { days: 60, label: "60 Tage" },
];

/** Papierkorb über alle Konten (Regel 10). */
export default function PapierkorbView({ accounts }: { accounts: Account[] }) {
  const ui = useUI();
  const [entries, setEntries] = useState<TrashEntry[] | null>(null);
  const [trashBytes, setTrashBytes] = useState<number | null>(null);
  const [autoDays, setAutoDays] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = accounts.filter((a) => a.status === "active");

  const load = async () => {
    try {
      const [list, quotas, settings] = await Promise.all([
        loadTrash(accounts),
        Promise.all(active.map((a) => getQuota(a.id).catch(() => null))),
        fetchSettings().catch(() => ({ trash_auto_days: null })),
      ]);
      setEntries(list);
      setTrashBytes(quotas.reduce((s, q) => s + (q?.trash ?? 0), 0));
      setAutoDays(settings.trash_auto_days);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeAuto = async (days: number | null) => {
    setAutoDays(days);
    try {
      await saveSettings({ trash_auto_days: days });
      if (days) {
        const r = await purgeOlderThan(accounts, days);
        ui.toast(r.count ? `${r.count} alte Einträge gelöscht (${formatBytes(r.bytes)})` : `Leert ab jetzt nach ${days} Tagen`, "ok");
        if (r.count) await load();
      } else {
        ui.toast("Automatisches Leeren aus", "info");
      }
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const run = async (list: TrashEntry[], label: string, fn: (e: TrashEntry) => Promise<unknown>) => {
    setProgress({ done: 0, total: list.length, label });
    let ok = 0;
    for (const e of list) {
      try {
        await fn(e);
        ok++;
      } catch {
        /* weiter */
      }
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    }
    setProgress(null);
    setSelected(new Set());
    setSelectMode(false);
    return ok;
  };

  const chosen = (entries ?? []).filter((e) => selected.has(key(e)));

  const restore = async () => {
    const ok = await run(chosen, "wiederhergestellt", (e) => restoreItem(e.account.id, e.file.id));
    await writeLog("move", `${ok} Einträge aus dem Papierkorb wiederhergestellt`);
    await syncAccounts([...new Set(chosen.map((e) => e.account.id))]).catch(() => undefined);
    invalidateAll();
    ui.toast(`${ok} wiederhergestellt`, "ok");
    await load();
  };

  const removeForever = async () => {
    const yes = await ui.confirm({
      title: `${chosen.length} endgültig löschen?`,
      message: "Das kann nicht rückgängig gemacht werden.",
      confirmLabel: "Endgültig löschen",
      danger: true,
    });
    if (!yes) return;
    const ok = await run(chosen, "gelöscht", (e) => deleteForever(e.account.id, e.file.id));
    await writeLog("delete", `${ok} Einträge endgültig gelöscht`);
    ui.toast(`${ok} endgültig gelöscht`, "ok");
    await load();
  };

  const emptyAll = async () => {
    const yes = await ui.confirm({
      title: "Papierkorb leeren?",
      message: `Alle ${entries?.length ?? 0} Einträge in allen Konten werden endgültig gelöscht${trashBytes ? ` – ${formatBytes(trashBytes)} werden frei` : ""}.`,
      confirmLabel: "Leeren",
      danger: true,
    });
    if (!yes) return;
    setProgress({ done: 0, total: active.length, label: "Konten geleert" });
    for (const a of active) {
      try {
        await emptyTrash(a.id);
      } catch (e) {
        ui.toast(`${a.email}: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    }
    setProgress(null);
    await writeLog("delete", "Papierkorb in allen Konten geleert");
    await syncAccounts(active.map((a) => a.id)).catch(() => undefined);
    ui.toast("Papierkorb geleert", "ok");
    await load();
  };

  const toggle = (e: TrashEntry) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key(e))) n.delete(key(e));
      else n.add(key(e));
      return n;
    });

  const folders = (entries ?? []).filter((e) => e.file.mimeType === "application/vnd.google-apps.folder");
  const files = (entries ?? []).filter((e) => e.file.mimeType !== "application/vnd.google-apps.folder");

  return (
    <div className="view page-forward">
      <Topbar
        eyebrow={
          entries ? `${entries.length} Einträge${trashBytes !== null ? ` · ${formatBytes(trashBytes)}` : ""}` : "Lädt …"
        }
        title="Papierkorb"
        left={
          <button className="icon-btn" onClick={() => navigate("mehr")} aria-label="Zurück">
            <Icon name="chevronLeft" />
          </button>
        }
        right={
          entries && entries.length > 0 ? (
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
          ) : undefined
        }
      />

      {error && (
        <div className="banner error">
          <Icon name="alert" size={18} />
          {error}
        </div>
      )}

      <section className="card glass stack enter">
        <div className="row between">
          <strong>Automatisch leeren</strong>
          <span className="muted small">{autoDays ? `nach ${autoDays} Tagen` : "aus"}</span>
        </div>
        <div className="chips" style={{ padding: 0 }}>
          {AUTO_OPTIONS.map((o) => (
            <button key={o.label} className={`chip ${autoDays === o.days ? "on" : ""}`} onClick={() => changeAuto(o.days)}>
              {o.label}
            </button>
          ))}
        </div>
        <span className="faint small">Gelöschte Fotos belegen weiter Speicher, bis der Papierkorb geleert ist.</span>
      </section>

      {progress ? (
        <div className="stack pad">
          <Ring value={progress.done} total={progress.total} label={progress.label} />
        </div>
      ) : entries === null ? (
        <GridSkeleton />
      ) : entries.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            <Icon name="trash" size={32} />
          </div>
          <strong>Papierkorb ist leer</strong>
        </div>
      ) : (
        <>
          {folders.length > 0 && (
            <>
              <div className="section-title">
                <span>Ordner</span>
                <span>{folders.length}</span>
              </div>
              <div className="folders stagger">
                {folders.map((e, i) => (
                  <button
                    key={key(e)}
                    className={`folder ${selected.has(key(e)) ? "picked" : ""}`}
                    style={{ ["--i" as string]: i, ["--h" as string]: folderHue(e.file.name) }}
                    onClick={() => selectMode && toggle(e)}
                  >
                    <span className="folder-icon">
                      <Icon name="folder" size={20} />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <div className="folder-name">{e.file.name}</div>
                      <div className="folder-meta">{formatDateTime(e.file.trashedTime ?? null)}</div>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          {files.length > 0 && (
            <>
              <div className="section-title">
                <span>Fotos</span>
                <span>{files.length}</span>
              </div>
              <div className="grid stagger">
                {files.map((e, i) => {
                  const ai = accounts.findIndex((a) => a.id === e.account.id);
                  return (
                    <button
                      key={key(e)}
                      className={`cell ${selected.has(key(e)) ? "selected" : ""}`}
                      style={{ ["--i" as string]: i }}
                      onClick={() => selectMode && toggle(e)}
                    >
                      <Thumb item={trashEntryItem(e)} />
                      {selectMode && (
                        <span className={`check ${selected.has(key(e)) ? "on" : ""}`}>
                          {selected.has(key(e)) && <Icon name="check" size={15} />}
                        </span>
                      )}
                      <span className="cell-name">
                        <span className="dot" style={{ background: accountColor(ai), color: accountColor(ai), width: 6, height: 6, display: "inline-block", marginRight: 4 }} />
                        {e.file.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {!selectMode && (
            <div className="stack pad" style={{ marginTop: 10 }}>
              <button className="btn danger-solid block" onClick={emptyAll}>
                <Icon name="trash" size={18} /> Papierkorb leeren
              </button>
            </div>
          )}
        </>
      )}

      {selectMode && (
        <div className="actionbar glass">
          <span>
            <b>{selected.size}</b> ausgewählt
          </span>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <button className="btn small" disabled={!selected.size} onClick={restore}>
              <Icon name="rotateCcw" size={16} /> Zurück
            </button>
            <button className="btn small danger-solid" disabled={!selected.size} onClick={removeForever}>
              <Icon name="trash" size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
