import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import Ring from "../components/Ring";
import { LineSkeleton } from "../components/Skeleton";
import Thumb from "../components/Thumb";
import Topbar from "../components/Topbar";
import { useUI } from "../components/ui";
import { invalidateAll } from "../lib/cache";
import { fetchDuplicates, ignoreDuplicate, syncAccounts, unignoreDuplicate, writeLog, type DuplicateGroup } from "../lib/db";
import { formatBytes } from "../lib/format";
import { trashItem } from "../lib/google";
import { navigate } from "../lib/route";
import { accountColor } from "../lib/theme";
import type { Account, Item } from "../lib/types";
import { AUTO_ROOT } from "./AutoUploadSheet";

const key = (i: Item) => `${i.account_id}|${i.drive_id}`;
const PAGE = 20;

/** Standard: das Foto in einem selbst sortierten Ordner behalten (nicht in der automatischen Ablage). */
export function defaultKeep(items: Item[]): string {
  const manual = items.filter((i) => !(i.path ?? "").startsWith(`${AUTO_ROOT}/`));
  const pool = manual.length ? manual : items;
  return key([...pool].sort((a, b) => (a.path ?? "").length - (b.path ?? "").length)[0]);
}

export default function DuplikateView({ accounts }: { accounts: Account[] }) {
  const ui = useUI();
  const [all, setAll] = useState<DuplicateGroup[] | null>(null);
  const groups = useMemo(() => all?.filter((g) => !g.ignored) ?? null, [all]);
  const ignored = useMemo(() => all?.filter((g) => g.ignored) ?? [], [all]);
  const [showIgnored, setShowIgnored] = useState(false);
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [shown, setShown] = useState(PAGE);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetchDuplicates()
      .then((g) => {
        setAll(g);
        setKeep(Object.fromEntries(g.map((x) => [x.md5, defaultKeep(x.items)])));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

  useEffect(() => {
    void load();
  }, []);

  const wasted = useMemo(
    () => (groups ?? []).reduce((s, g) => s + (g.items[0]?.size ?? 0) * (g.total - 1), 0),
    [groups],
  );

  const removeItems = async (items: Item[]) => {
    setProgress({ done: 0, total: items.length });
    const touched = new Set<string>();
    let ok = 0;
    for (const it of items) {
      try {
        await trashItem(it.account_id, it.drive_id);
        touched.add(it.account_id);
        ok++;
      } catch {
        /* weiter */
      }
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    }
    await writeLog("delete", `Duplikate aufgeräumt: ${ok} Foto(s) in den Papierkorb`, {
      namen: items.slice(0, 200).map((i) => i.path),
    });
    await syncAccounts([...touched]).catch(() => undefined);
    invalidateAll();
    setProgress(null);
    ui.toast(`${ok} Duplikat${ok === 1 ? "" : "e"} entfernt`, "ok");
    await load();
  };

  const cleanGroup = async (g: DuplicateGroup) => {
    const k = keep[g.md5];
    await removeItems(g.items.filter((i) => key(i) !== k));
  };

  const cleanAll = async () => {
    if (!groups) return;
    const items = groups.flatMap((g) => g.items.filter((i) => key(i) !== keep[g.md5]));
    const ok = await ui.confirm({
      title: `${items.length} Duplikate entfernen?`,
      message: `Pro Gruppe bleibt das markierte Foto erhalten. Die anderen landen im Papierkorb (${formatBytes(wasted)}).`,
      confirmLabel: "Aufräumen",
      danger: true,
    });
    if (ok) await removeItems(items);
  };

  const accIndex = (id: string) => accounts.findIndex((a) => a.id === id);

  /** Gehört thematisch in mehrere Ordner → alle Kopien behalten und nicht mehr vorschlagen */
  const keepAll = async (g: DuplicateGroup) => {
    setAll((a) => a?.map((x) => (x.md5 === g.md5 ? { ...x, ignored: true } : x)) ?? a);
    try {
      await ignoreDuplicate(g.md5);
      ui.toast("Behalten – wird nicht mehr als Duplikat vorgeschlagen", "ok");
    } catch (e) {
      setAll((a) => a?.map((x) => (x.md5 === g.md5 ? { ...x, ignored: false } : x)) ?? a);
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    }
  };
  const undoKeepAll = async (g: DuplicateGroup) => {
    setAll((a) => a?.map((x) => (x.md5 === g.md5 ? { ...x, ignored: false } : x)) ?? a);
    try {
      await unignoreDuplicate(g.md5);
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
      await load();
    }
  };
  const folderOf = (it: Item) => (it.path ?? "").split("/").slice(0, -1).join("/") || "Drive";
  const distinctFolders = (g: DuplicateGroup) => new Set(g.items.map((i) => i.parent_key)).size > 1;

  // Bewusst behaltene Gruppen: eingeklappt, mit „Wieder vorschlagen“
  const IgnoredList = () =>
    ignored.length === 0 ? null : (
      <>
        <div className="section-title">
          <span>Bewusst behalten</span>
          <button className="link small" onClick={() => setShowIgnored((v) => !v)}>
            {showIgnored ? "Ausblenden" : `Anzeigen (${ignored.length})`}
          </button>
        </div>
        {showIgnored &&
          ignored.map((g) => (
            <section key={g.md5} className="card glass stack" style={{ gap: 8 }}>
              <div className="row between small">
                <span className="muted">
                  {g.total}× · {formatBytes(g.items[0]?.size)}
                </span>
                <button className="btn small ghost" onClick={() => undoKeepAll(g)}>
                  <Icon name="rotateCcw" size={15} /> Wieder vorschlagen
                </button>
              </div>
              <div className="row" style={{ gap: 10, alignItems: "center" }}>
                <div style={{ width: 52, height: 52, borderRadius: 10, overflow: "hidden", flexShrink: 0 }}>
                  <Thumb item={g.items[0]} />
                </div>
                <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                  {g.items.map((it) => (
                    <span key={key(it)} className="small ellipsis">
                      {folderOf(it)}
                    </span>
                  ))}
                </div>
              </div>
            </section>
          ))}
      </>
    );

  return (
    <div className="view page-forward">
      <Topbar
        eyebrow={groups ? `${groups.length} Gruppen · ${formatBytes(wasted)} doppelt` : "Wird gesucht …"}
        title="Duplikate"
        left={
          <button className="icon-btn" onClick={() => navigate("mehr")} aria-label="Zurück">
            <Icon name="chevronLeft" />
          </button>
        }
      />
      {error && (
        <div className="banner error">
          <Icon name="alert" size={18} />
          {error}
        </div>
      )}

      {progress ? (
        <div className="stack pad">
          <Ring value={progress.done} total={progress.total} label="entfernt" />
        </div>
      ) : groups === null ? (
        <LineSkeleton count={8} />
      ) : groups.length === 0 ? (
        <>
          <div className="empty">
            <div className="empty-icon">
              <Icon name="checkCircle" size={34} />
            </div>
            <strong>Keine Duplikate</strong>
            <span>{ignored.length ? "Übrig sind nur bewusst behaltene Fotos." : "Jedes Foto ist nur einmal im Pool."}</span>
          </div>
          <IgnoredList />
        </>
      ) : (
        <>
          <p className="muted small pad">
            Gleiche Fotos werden über ihre Prüfsumme erkannt. Tippe das Foto an, das bleiben soll – die anderen
            landen im Papierkorb. Gehört ein Foto in mehrere Ordner, tippe auf „Beide behalten“.
          </p>
          <div className="stack pad" style={{ marginTop: 10 }}>
            <button className="btn primary block" onClick={cleanAll}>
              <Icon name="sparkles" size={19} /> Alle aufräumen ({formatBytes(wasted)})
            </button>
          </div>
          <div className="stagger">
            {groups.slice(0, shown).map((g, gi) => (
              <section key={g.md5} className="card glass dup-group" style={{ ["--i" as string]: gi }}>
                <div className="row between small">
                  <span className="muted">
                    {g.total}× · {formatBytes(g.items[0]?.size)}
                  </span>
                  <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                    {distinctFolders(g) && (
                      <button className="btn small ghost" onClick={() => keepAll(g)} title="Gehört thematisch in mehrere Ordner">
                        <Icon name="check" size={15} /> {g.total === 2 ? "Beide behalten" : "Alle behalten"}
                      </button>
                    )}
                    <button className="btn small" onClick={() => cleanGroup(g)}>
                      <Icon name="trash" size={15} /> {g.total - 1} entfernen
                    </button>
                  </span>
                </div>
                <div className="dup-row">
                  {g.items.map((it) => {
                    const on = keep[g.md5] === key(it);
                    const ai = accIndex(it.account_id);
                    return (
                      <button
                        key={key(it)}
                        className={`dup-item ${on ? "keep" : ""}`}
                        onClick={() => setKeep((k) => ({ ...k, [g.md5]: key(it) }))}
                      >
                        <Thumb item={it} />
                        {on && <span className="dup-keep">Behalten</span>}
                        <span className="dup-path">
                          <span className="dot" style={{ background: accountColor(ai), color: accountColor(ai) }} />
                          {it.path}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
          {shown < groups.length && (
            <div className="stack pad">
              <button className="btn block" onClick={() => setShown((s) => s + PAGE)}>
                Weitere anzeigen ({groups.length - shown})
              </button>
            </div>
          )}
          <IgnoredList />
        </>
      )}
    </div>
  );
}
