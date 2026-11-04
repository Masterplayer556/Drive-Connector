import { lazy, Suspense, useEffect, useMemo, useState } from "react";
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
import { dupKey as key, inRandom, pickOne, suggestRemoval } from "../lib/duplicates";
import type { Account, Item } from "../lib/types";
import { AUTO_ROOT } from "./AutoUploadSheet";
import { useAiEnabled } from "../ai/flag"; // KI-SUCHE

const AiSimilarDuplicates = lazy(() => import("../ai/AiSimilarDuplicates")); // KI-SUCHE

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
  // Fokus: Kopien im selben Ordner und Random-Kopien – der Rest (verschiedene Ordner) eingeklappt
  const suggested = useMemo(() => new Map((all ?? []).map((g) => [g.md5, suggestRemoval(g.items)])), [all]);
  const open = useMemo(() => all?.filter((g) => !g.ignored) ?? null, [all]);
  const groups = useMemo(() => open?.filter((g) => suggested.get(g.md5)?.size) ?? null, [open, suggested]);
  const others = useMemo(() => open?.filter((g) => !suggested.get(g.md5)?.size) ?? [], [open, suggested]);
  const [showOthers, setShowOthers] = useState(false);
  const ignored = useMemo(() => all?.filter((g) => g.ignored) ?? [], [all]);
  const [showIgnored, setShowIgnored] = useState(false);
  /** Pro Gruppe: diese Kopien kommen weg (der Rest bleibt) */
  const [remove, setRemove] = useState<Record<string, string[]>>({});
  const [shown, setShown] = useState(PAGE);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ai = useAiEnabled(); // KI-SUCHE

  const load = () =>
    fetchDuplicates()
      .then((g) => {
        setAll(g);
        setRemove(
          Object.fromEntries(
            g.map((x) => {
              const s = suggestRemoval(x.items);
              const k = defaultKeep(x.items);
              return [x.md5, s.size ? [...s] : x.items.map(key).filter((i) => i !== k)];
            }),
          ),
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

  useEffect(() => {
    void load();
  }, []);

  const removing = (g: DuplicateGroup) => g.items.filter((i) => (remove[g.md5] ?? []).includes(key(i)));
  const wasted = useMemo(
    () => (groups ?? []).reduce((s, g) => s + (g.items[0]?.size ?? 0) * (remove[g.md5]?.length ?? 0), 0),
    [groups, remove],
  );
  /** Antippen: Kopie behalten ↔ entfernen (mindestens eine bleibt immer) */
  const toggle = (g: DuplicateGroup, k: string) =>
    setRemove((r) => {
      const cur = r[g.md5] ?? [];
      if (cur.includes(k)) return { ...r, [g.md5]: cur.filter((x) => x !== k) };
      if (cur.length >= g.items.length - 1) return r;
      return { ...r, [g.md5]: [...cur, k] };
    });

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

  const groupCard = (g: DuplicateGroup, gi: number) => {
    const rm = remove[g.md5] ?? [];
    const one = g.total >= 3 && rm.length !== 1;
    return (
      <section key={g.md5} className="card glass dup-group" style={{ ["--i" as string]: gi }}>
        <div className="row between small">
          <span className="muted">
            {g.total}× · {formatBytes(g.items[0]?.size)}
            {g.items.some(inRandom) && " · Random"}
          </span>
          <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
            {distinctFolders(g) && (
              <button className="btn small ghost" onClick={() => keepAll(g)} title="Gehört thematisch in mehrere Ordner">
                <Icon name="check" size={15} /> {g.total === 2 ? "Beide behalten" : "Alle behalten"}
              </button>
            )}
            <button className="btn small" disabled={!rm.length} onClick={() => cleanGroup(g)}>
              <Icon name="trash" size={15} /> {rm.length} entfernen
            </button>
          </span>
        </div>
        {one && (
          <button className="link small dup-one" onClick={() => setRemove((r) => ({ ...r, [g.md5]: [pickOne(g.items)] }))}>
            Nur 1 entfernen, {g.total - 1} behalten
          </button>
        )}
        <div className="dup-row">
          {g.items.map((it) => {
            const on = !rm.includes(key(it));
            const ai = accIndex(it.account_id);
            return (
              <button key={key(it)} className={`dup-item ${on ? "keep" : ""}`} onClick={() => toggle(g, key(it))}>
                <Thumb item={it} />
                <span className={`dup-keep ${on ? "" : "gone"}`}>{on ? "Behalten" : "Entfernen"}</span>
                <span className="dup-path">
                  <span className="dot" style={{ background: accountColor(ai), color: accountColor(ai) }} />
                  {it.path}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    );
  };

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
            <strong>Keine Duplikate im selben Ordner</strong>
            <span>
              {others.length
                ? "Übrig sind nur Fotos, die in verschiedenen Ordnern liegen."
                : ignored.length
                  ? "Übrig sind nur bewusst behaltene Fotos."
                  : "Jedes Foto ist nur einmal im Pool."}
            </span>
          </div>
          <OthersList />
          <IgnoredList />
        </>
      ) : (
        <>
          <p className="muted small pad">
            Hier sind gleiche Fotos im selben Ordner und Kopien im Ordner „Random“, die es schon woanders gibt.
            Antippen = behalten oder entfernen. Bei 3 oder mehr Kopien kannst du auch nur eine entfernen.
          </p>
          <div className="stack pad" style={{ marginTop: 10 }}>
            <button className="btn primary block" onClick={cleanAll}>
              <Icon name="sparkles" size={19} /> Alle aufräumen ({formatBytes(wasted)})
            </button>
          </div>
          <div className="stagger">{groups.slice(0, shown).map((g, gi) => groupCard(g, gi))}</div>
          {shown < groups.length && (
            <div className="stack pad">
              <button className="btn block" onClick={() => setShown((s) => s + PAGE)}>
                Weitere anzeigen ({groups.length - shown})
              </button>
            </div>
          )}
          <OthersList />
          <IgnoredList />
        </>
      )}
      {/* KI-SUCHE */}
      {ai && !progress && groups !== null && (
        <Suspense fallback={null}>
          <AiSimilarDuplicates accounts={accounts} />
        </Suspense>
      )}
    </div>
  );
}
