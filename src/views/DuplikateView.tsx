import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon";
import Ring from "../components/Ring";
import { LineSkeleton } from "../components/Skeleton";
import Thumb from "../components/Thumb";
import Topbar from "../components/Topbar";
import { useUI } from "../components/ui";
import { invalidateAll } from "../lib/cache";
import {
  fetchDuplicates,
  fetchItemsByMd5,
  fetchLookIgnores,
  ignoreDuplicate,
  ignoreLook,
  syncAccounts,
  unignoreDuplicate,
  writeLog,
} from "../lib/db";
import { formatBytes } from "../lib/format";
import { trashItem } from "../lib/google";
import { fineFor, lookCount, lookGroups, lookMissingCount, scanLook, syncLook, type ScanProgress } from "../lib/lookScan";
import { applyFine, fineTodo } from "../lib/lookVerify";
import { DRIVE_PARALLEL, mapPool } from "../lib/pool";
import { navigate } from "../lib/route";
import { accountColor } from "../lib/theme";
import { dupKey as key, inRandom, lookKey, pickOne, qualityFirst, suggestRemoval } from "../lib/duplicates";
import type { Account, Item } from "../lib/types";
import { AUTO_ROOT } from "./AutoUploadSheet";
import { useKeepAwake } from "../lib/wakelock";

const Viewer = lazy(() => import("../components/Viewer"));

const PAGE = 20;
/** So viele noch nicht geprüfte Fotos werden beim Öffnen von selbst geprüft (mehr nur auf Knopfdruck) */
const AUTO_SCAN = 400;
const FINE_CACHE = "drivepool.look.fine";

/** Gemerkte Urteile der Feinprüfung (Paar von Prüfsummen → gleich?) */
function readFineCache(): Map<string, boolean> {
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem(FINE_CACHE) ?? "{}") as Record<string, boolean>));
  } catch {
    return new Map();
  }
}
function writeFineCache(m: Map<string, boolean>) {
  try {
    // Nur die neuesten behalten (Map behält die Reihenfolge des Eintragens)
    localStorage.setItem(FINE_CACHE, JSON.stringify(Object.fromEntries([...m].slice(-5000))));
  } catch {
    /* ignorieren */
  }
}

/** Eine Gruppe gleicher Fotos: exakt dieselbe Datei (Prüfsumme) oder nur gleich aussehend (andere Datei). */
interface Group {
  /** Prüfsumme bzw. „look:…“ */
  id: string;
  items: Item[];
  total: number;
  ignored: boolean;
  /** Sieht gleich aus, ist aber nicht dieselbe Datei */
  look: boolean;
  /** Screenshot/Grafik, die sich nicht genau vergleichen liess → keine Vorauswahl */
  unsure?: boolean;
}

/** Standard: das Foto in einem selbst sortierten Ordner behalten (nicht in der automatischen Ablage). */
export function defaultKeep(items: Item[]): string {
  const manual = items.filter((i) => !(i.path ?? "").startsWith(`${AUTO_ROOT}/`));
  const pool = manual.length ? manual : items;
  return key([...pool].sort((a, b) => (a.path ?? "").length - (b.path ?? "").length)[0]);
}

/** Pfad mit Umbruchstellen nach jedem „/“ – lange Pfade laufen so über mehrere Zeilen statt abgeschnitten zu werden. */
const breakable = (path: string) =>
  path.split("/").map((part, i, all) => (
    <span key={i}>
      {part}
      {i < all.length - 1 && (
        <>
          /<wbr />
        </>
      )}
    </span>
  ));

/** Bei nur gleich aussehenden Fotos bleibt im Ordner das beste (höchste Auflösung, Originalformat …). */
const preferOf = (g: Pick<Group, "look">) => (g.look ? qualityFirst : undefined);
const suggest = (g: Group) => suggestRemoval(g.items, preferOf(g));
const sizeOf = (g: Group) => Math.max(0, ...g.items.map((i) => i.size ?? 0));
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const folderKeys = (items: Item[]) => items.map((i) => i.parent_key ?? "").sort();

/** Vorauswahl pro Gruppe: der Vorschlag – sonst alle bis auf eine Kopie. */
function defaults(groups: Group[]): Record<string, string[]> {
  return Object.fromEntries(
    groups.map((g) => {
      if (g.unsure) return [g.id, []]; // nicht sicher gleich → selbst vergleichen und antippen
      const s = suggest(g);
      const k = g.look ? key([...g.items].sort(qualityFirst)[0]) : defaultKeep(g.items);
      return [g.id, s.size ? [...s] : g.items.map(key).filter((i) => i !== k)];
    }),
  );
}

export default function DuplikateView({ accounts }: { accounts: Account[] }) {
  const ui = useUI();
  const [exact, setExact] = useState<Group[] | null>(null);
  const [looks, setLooks] = useState<Group[]>([]);
  const all = useMemo(() => (exact ? [...exact, ...looks] : null), [exact, looks]);
  // Fokus: Kopien im selben Ordner und Random-Kopien – der Rest (verschiedene Ordner) eingeklappt
  const suggested = useMemo(() => new Map((all ?? []).map((g) => [g.id, suggest(g)])), [all]);
  const open = useMemo(() => all?.filter((g) => !g.ignored) ?? null, [all]);
  const groups = useMemo(() => open?.filter((g) => !g.look && suggested.get(g.id)?.size) ?? null, [open, suggested]);
  const lookFocus = useMemo(() => open?.filter((g) => g.look && suggested.get(g.id)?.size) ?? [], [open, suggested]);
  const others = useMemo(() => open?.filter((g) => !suggested.get(g.id)?.size) ?? [], [open, suggested]);
  const [showOthers, setShowOthers] = useState(false);
  const ignored = useMemo(() => all?.filter((g) => g.ignored) ?? [], [all]);
  const [showIgnored, setShowIgnored] = useState(false);
  /** Pro Gruppe: diese Kopien kommen weg (der Rest bleibt) */
  const [remove, setRemove] = useState<Record<string, string[]>>({});
  const [shown, setShown] = useState(PAGE);
  const [shownLook, setShownLook] = useState(PAGE);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Fotos gross ansehen und vergleichen */
  const [viewing, setViewing] = useState<{ items: Item[]; index: number } | null>(null);
  // „Sieht gleich aus“: Stand auf diesem Gerät und laufende Prüfung
  /** count = auf diesem Gerät bekannte Abbilder, missing = Fotos im Pool ohne Abbild (null = noch unbekannt) */
  const [lookInfo, setLookInfo] = useState<{ count: number; missing: number | null }>({ count: 0, missing: null });
  const [scan, setScan] = useState<ScanProgress | null>(null);
  /** Screenshots werden gerade genauer verglichen */
  const [fining, setFining] = useState(0);
  const abort = useRef<AbortController | null>(null);
  useKeepAwake(!!progress || (!!scan && scan.total > 200)); // Bildschirm bleibt an, solange es läuft

  const load = () =>
    fetchDuplicates()
      .then((list) => {
        const g = list.map((x): Group => ({ id: x.md5, items: x.items, total: x.total, ignored: x.ignored, look: false }));
        setExact(g);
        setRemove((r) => ({ ...r, ...defaults(g) }));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

  /** Gruppen gleich aussehender Fotos aus den Abbildern auf diesem Gerät (ohne Netz bis auf die Fundstellen). */
  const loadLooks = async () => {
    const sets = await lookGroups();
    const count = await lookCount();
    setLookInfo((i) => ({ ...i, count }));
    if (!sets.length) return setLooks([]);
    const [items, ignores] = await Promise.all([fetchItemsByMd5(sets.flat()), fetchLookIgnores()]);
    const byMd5 = new Map<string, Item[]>();
    for (const it of items) if (it.md5) byMd5.set(it.md5, [...(byMd5.get(it.md5) ?? []), it]);
    // Nur noch eine Datei übrig (Rest gelöscht) → keine Gruppe mehr; byte-gleiche Kopien zeigt die Liste oben
    const raw = sets
      .map((set) => set.flatMap((m) => byMd5.get(m) ?? []).sort((a, b) => (a.path ?? "").localeCompare(b.path ?? "")))
      .filter((its) => new Set(its.map((i) => i.md5)).size >= 2);
    const build = (checked: ReturnType<typeof applyFine>) =>
      checked
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map((c): Group => {
          const id = lookKey(c.items.map((i) => i.md5!));
          const ig = ignores.get(id);
          return {
            id,
            items: c.items,
            total: c.items.length,
            look: true,
            unsure: c.unsure,
            ignored: !!ig && sameList([...ig].sort(), folderKeys(c.items)),
          };
        })
        .sort((a, b) => sizeOf(b) - sizeOf(a));
    const show = (g: Group[]) => {
      setLooks(g);
      setRemove((r) => ({ ...r, ...defaults(g) }));
    };
    // Screenshots/Grafiken genauer vergleichen – bis dahin nur zeigen, was schon entschieden ist
    const cache = readFineCache();
    const todo = fineTodo(raw, cache);
    if (!todo.length) return show(build(applyFine(raw, new Map(), cache)));
    const pending = new Set(fineTodo(raw, cache).map((i) => i.md5));
    show(build(applyFine(raw.filter((its) => !its.some((i) => pending.has(i.md5))), new Map(), cache)));
    setFining((n) => n + 1);
    try {
      const fine = await fineFor(todo);
      const checked = applyFine(raw, fine, cache);
      writeFineCache(cache);
      show(build(checked));
    } finally {
      setFining((n) => n - 1);
    }
  };

  /** Fotos prüfen, die noch kein Abbild haben (egal wie alt – der Server weiss, welche fehlen). */
  const runScan = async () => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setScan({ done: 0, total: 0 });
    try {
      await scanLook({ signal: ac.signal, onProgress: (p) => !ac.signal.aborted && setScan(p) });
      await loadLooks();
    } catch (e) {
      if (!ac.signal.aborted) ui.toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      if (abort.current === ac) {
        abort.current = null;
        setScan(null);
        const missing = await lookMissingCount().catch(() => null);
        setLookInfo({ count: await lookCount(), missing });
      }
    }
  };
  const stopScan = () => {
    abort.current?.abort();
    abort.current = null;
    setScan(null);
    void loadLooks().catch(() => undefined);
    void lookMissingCount()
      .then((missing) => setLookInfo((i) => ({ ...i, missing })))
      .catch(() => undefined);
  };

  useEffect(() => {
    void load();
    // Sofort zeigen, was auf dem Gerät schon bekannt ist – dann vom Server nachholen (andere Geräte) und
    // fehlende Fotos prüfen: wenige von selbst, viele erst auf Knopfdruck
    void (async () => {
      await loadLooks().catch(() => undefined);
      const before = await lookCount();
      await syncLook().catch(() => undefined);
      if ((await lookCount()) !== before) await loadLooks().catch(() => undefined);
      const missing = await lookMissingCount().catch(() => null);
      setLookInfo({ count: await lookCount(), missing });
      if (missing && missing <= AUTO_SCAN) await runScan();
    })();
    return () => abort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removing = (g: Group) => g.items.filter((i) => (remove[g.id] ?? []).includes(key(i)));
  const wasted = useMemo(
    () => (groups ?? []).reduce((s, g) => s + (g.items[0]?.size ?? 0) * (remove[g.id]?.length ?? 0), 0),
    [groups, remove],
  );
  /** Antippen: Kopie behalten ↔ entfernen (mindestens eine bleibt immer) */
  const toggle = (g: Group, k: string) =>
    setRemove((r) => {
      const cur = r[g.id] ?? [];
      if (cur.includes(k)) return { ...r, [g.id]: cur.filter((x) => x !== k) };
      if (cur.length >= g.items.length - 1) return r;
      return { ...r, [g.id]: [...cur, k] };
    });

  const removeItems = async (items: Item[]) => {
    setProgress({ done: 0, total: items.length });
    const touched = new Set<string>();
    let ok = 0;
    await mapPool(items, DRIVE_PARALLEL, async (it) => {
      try {
        await trashItem(it.account_id, it.drive_id);
        touched.add(it.account_id);
        ok++;
      } catch {
        /* weiter */
      }
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    });
    await writeLog("delete", `Duplikate aufgeräumt: ${ok} Foto(s) in den Papierkorb`, {
      namen: items.slice(0, 200).map((i) => i.path),
    });
    await syncAccounts([...touched]).catch(() => undefined);
    invalidateAll();
    setProgress(null);
    ui.toast(`${ok} Duplikat${ok === 1 ? "" : "e"} entfernt`, "ok");
    await load();
    await loadLooks().catch(() => undefined);
  };

  const cleanGroup = async (g: Group) => {
    const items = removing(g);
    if (items.length) await removeItems(items);
  };

  const cleanAll = async () => {
    if (!groups) return;
    const items = groups.flatMap(removing);
    if (!items.length) return;
    const ok = await ui.confirm({
      title: `${items.length} Duplikate entfernen?`,
      message: `Pro Gruppe bleiben die markierten Fotos erhalten. Die anderen landen im Papierkorb (${formatBytes(wasted)}).`,
      confirmLabel: "Aufräumen",
      danger: true,
    });
    if (ok) await removeItems(items);
  };

  const accIndex = (id: string) => accounts.findIndex((a) => a.id === id);

  const mark = (id: string, value: boolean) => {
    const set = (list: Group[]) => list.map((x) => (x.id === id ? { ...x, ignored: value } : x));
    setExact((a) => (a ? set(a) : a));
    setLooks(set);
  };
  /** Gehört thematisch in mehrere Ordner (oder ist doch nicht dasselbe Bild) → alle behalten und nicht mehr vorschlagen */
  const keepAll = async (g: Group) => {
    mark(g.id, true);
    try {
      await (g.look ? ignoreLook(g.id, folderKeys(g.items)) : ignoreDuplicate(g.id));
      ui.toast("Behalten – wird nicht mehr als Duplikat vorgeschlagen", "ok");
    } catch (e) {
      mark(g.id, false);
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    }
  };
  const undoKeepAll = async (g: Group) => {
    mark(g.id, false);
    try {
      await unignoreDuplicate(g.id);
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
      await load();
      await loadLooks().catch(() => undefined);
    }
  };
  const folderOf = (it: Item) => (it.path ?? "").split("/").slice(0, -1).join("/") || "Drive";
  const distinctFolders = (g: Group) => new Set(g.items.map((i) => i.parent_key)).size > 1;

  const groupCard = (g: Group, gi: number) => {
    const rm = remove[g.id] ?? [];
    const one = g.total >= 3 && rm.length !== 1;
    return (
      <section key={g.id} className="card glass dup-group" style={{ ["--i" as string]: gi }}>
        <div className="row between small">
          <span className="muted">
            {g.total}×{g.look ? " · sieht gleich aus" : ` · ${formatBytes(g.items[0]?.size)}`}
            {g.items.some(inRandom) && " · Random"}
            {g.unsure && " · nicht sicher, bitte vergleichen"}
          </span>
          <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
            {(g.look || distinctFolders(g)) && (
              <button
                className="btn small ghost"
                onClick={() => keepAll(g)}
                title={g.look ? "Nicht dasselbe Bild oder bewusst doppelt" : "Gehört thematisch in mehrere Ordner"}
              >
                <Icon name="check" size={15} /> {g.total === 2 ? "Beide behalten" : "Alle behalten"}
              </button>
            )}
            <button className="btn small" disabled={!rm.length} onClick={() => cleanGroup(g)}>
              <Icon name="trash" size={15} /> {rm.length} entfernen
            </button>
          </span>
        </div>
        {one && (
          <button className="link small dup-one" onClick={() => setRemove((r) => ({ ...r, [g.id]: [pickOne(g.items, preferOf(g))] }))}>
            Nur 1 entfernen, {g.total - 1} behalten
          </button>
        )}
        <div className="dup-row">
          {g.items.map((it, ii) => {
            const on = !rm.includes(key(it));
            const ai = accIndex(it.account_id);
            return (
              <div key={key(it)} className="dup-cell">
                <button className={`dup-item ${on ? "keep" : ""}`} onClick={() => toggle(g, key(it))}>
                  <Thumb item={it} />
                  <span className={`dup-keep ${on ? "" : "gone"}`}>{on ? "Behalten" : "Entfernen"}</span>
                  <span className="dup-path">
                    <span className="dot" style={{ background: accountColor(ai), color: accountColor(ai) }} />
                    <span className="dup-path-text">
                      <span className="dup-folder">{breakable(folderOf(it))}</span>
                      <span className="dup-file">
                        {g.look && `${it.width && it.height ? `${it.width}×${it.height} · ` : ""}${formatBytes(it.size)} · `}
                        {it.name}
                      </span>
                    </span>
                  </span>
                </button>
                <button className="dup-zoom" onClick={() => setViewing({ items: g.items, index: ii })} aria-label="Gross ansehen und vergleichen">
                  <Icon name="eye" size={15} />
                </button>
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  // Gleiches Bild als andere Datei (neu gespeichert, andere Auflösung …) – ohne KI, über kleine Abbilder auf dem Gerät
  const scanned = lookInfo.count.toLocaleString("de-CH");
  const missing = (lookInfo.missing ?? 0).toLocaleString("de-CH");
  const LookSection = () => (
    <>
      <div className="section-title">
        <span>
          <Icon name="eye" size={14} /> Sieht gleich aus
        </span>
        {lookFocus.length > 0 && <span>{lookFocus.length}</span>}
      </div>
      {scan ? (
        <div className="card glass stack look-scan" style={{ gap: 10 }}>
          <div className="row between small">
            <span>
              {scan.total ? `Fotos werden geprüft … ${scan.done.toLocaleString("de-CH")} von ${scan.total.toLocaleString("de-CH")}` : "Neue Fotos werden gesucht …"}
            </span>
            <button className="link small" onClick={stopScan}>
              Anhalten
            </button>
          </div>
          <div className="look-bar">
            <i style={{ width: `${scan.total ? (scan.done / scan.total) * 100 : 0}%` }} />
          </div>
          <span className="faint small">Du kannst anhalten und später weitermachen – das Geprüfte bleibt (auch für deine anderen Geräte).</span>
        </div>
      ) : lookInfo.missing ? (
        <div className="stack pad" style={{ gap: 8 }}>
          <p className="muted small" style={{ margin: 0 }}>
            Findet dasselbe Bild auch als andere Datei – z. B. zweimal gespeichert, anders benannt oder in anderer Auflösung. Dafür wird
            von jedem Foto einmal eine kleine Vorschau geladen und verglichen (ohne KI, gilt danach für alle Geräte).{" "}
            {missing} Foto{lookInfo.missing === 1 ? "" : "s"} noch nicht geprüft{lookInfo.count > 0 && `, ${scanned} schon`}.
          </p>
          <button className="btn block" onClick={runScan}>
            <Icon name="search" size={18} /> {lookInfo.count > 0 ? `Weiter prüfen (${missing})` : "Alle Fotos prüfen"}
          </button>
        </div>
      ) : null}
      {!scan && (
        <>
          <p className="muted small pad">
            {lookFocus.length > 0
              ? "Gleiches Bild, aber andere Datei (z. B. neu gespeichert oder andere Auflösung). Vorausgewählt bleibt das beste: höchste Auflösung, dann Originalformat – mit dem Auge kannst du die Fotos gross vergleichen. Screenshots werden zusätzlich genau verglichen. "
              : lookInfo.count > 0
                ? "Keine gleich aussehenden Fotos im selben Ordner. "
                : ""}
            {lookInfo.count > 0 && `${scanned} Fotos geprüft.`}
            {fining > 0 && " Screenshots werden genau verglichen …"}
          </p>
          <div className="stagger">{lookFocus.slice(0, shownLook).map((g, gi) => groupCard(g, gi))}</div>
          {shownLook < lookFocus.length && (
            <div className="stack pad">
              <button className="btn block" onClick={() => setShownLook((n) => n + PAGE)}>
                Weitere anzeigen ({lookFocus.length - shownLook})
              </button>
            </div>
          )}
        </>
      )}
    </>
  );

  // Gleiche Fotos in verschiedenen Ordnern: nicht im Fokus, nur auf Wunsch
  const OthersList = () =>
    others.length === 0 ? null : (
      <>
        <div className="section-title">
          <span>In verschiedenen Ordnern</span>
          <button className="link small" onClick={() => setShowOthers((v) => !v)}>
            {showOthers ? "Ausblenden" : `Anzeigen (${others.length})`}
          </button>
        </div>
        {showOthers && <div className="stagger">{others.map((g, gi) => groupCard(g, gi))}</div>}
      </>
    );

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
            <section key={g.id} className="card glass stack" style={{ gap: 8 }}>
              <div className="row between small">
                <span className="muted">
                  {g.total}×{g.look ? " · sieht gleich aus" : ` · ${formatBytes(g.items[0]?.size)}`}
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
                    <span key={key(it)} className="small dup-folder">
                      {breakable(folderOf(it))}
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
        eyebrow={groups ? `${groups.length + lookFocus.length} Gruppen · ${formatBytes(wasted)} doppelt` : "Wird gesucht …"}
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
      ) : (
        <>
          {groups.length === 0 ? (
            lookFocus.length === 0 && (
              <div className="empty">
                <div className="empty-icon">
                  <Icon name="checkCircle" size={34} />
                </div>
                <strong>Keine Duplikate im selben Ordner</strong>
                <span>
                  {others.length
                    ? "Übrig sind nur Fotos, die in verschiedenen Ordnern liegen."
                    : ignored.length
                      ? "Übrig sind nur bewusst behaltene Fotos."
                      : "Jedes Foto ist nur einmal im Pool."}
                </span>
              </div>
            )
          ) : (
            <>
              <p className="muted small pad">
                Hier sind gleiche Fotos im selben Ordner und Kopien direkt im Ordner „Random“ (nicht in Unterordnern), die es schon woanders
                gibt. Antippen = behalten oder entfernen, das Auge zeigt das Foto gross. Bei 3 oder mehr Kopien kannst du auch nur eine
                entfernen.
              </p>
              <div className="stack pad" style={{ marginTop: 10 }}>
                <button className="btn primary block" onClick={cleanAll}>
                  <Icon name="sparkles" size={19} /> Alle aufräumen ({formatBytes(wasted)})
                </button>
              </div>
              <div className="stagger">{groups.slice(0, shown).map((g, gi) => groupCard(g, gi))}</div>
              {shown < groups.length && (
                <div className="stack pad">
                  <button className="btn block" onClick={() => setShown((n) => n + PAGE)}>
                    Weitere anzeigen ({groups.length - shown})
                  </button>
                </div>
              )}
            </>
          )}
          {LookSection()}
          {OthersList()}
          {IgnoredList()}
        </>
      )}
      {viewing && viewing.items[viewing.index] && (
        <Suspense fallback={null}>
          <Viewer
            items={viewing.items}
            index={viewing.index}
            accounts={accounts}
            onIndex={(index) => setViewing((v) => (v ? { ...v, index } : v))}
            onClose={() => setViewing(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
