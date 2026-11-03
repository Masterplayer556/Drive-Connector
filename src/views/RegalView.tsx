import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import Segmented from "../components/Segmented";
import { LineSkeleton } from "../components/Skeleton";
import Topbar from "../components/Topbar";
import { useUI } from "../components/ui";
import { runRebalance, saveGroupFolder, savePlan, setLock } from "../lib/db";
import { formatBytes, formatDateTime } from "../lib/format";
import { blockOf, isLocked, type Unit } from "../lib/rebalance";
import { loadRebalance, toCaps, type RebalanceState } from "../lib/rebalanceData";
import { navigate } from "../lib/route";
import { accountColor, folderHue } from "../lib/theme";
import type { Account } from "../lib/types";

interface Segment {
  key: string;
  label: string;
  bytes: number;
  files: number;
  locked: boolean;
  moving: "in" | "out" | null;
  units: Unit[];
}

const MAX_SEGMENTS = 7;
const unitId = (u: { account_id: string; folder_id: string }) => `${u.account_id}|${u.folder_id}`;

/** Regal-Ansicht (#4): jedes Konto ein Regalbrett, Ordner als Blöcke; Vorschläge mit Ausführen/Ablehnen. */
export default function RegalView({ accounts }: { accounts: Account[] }) {
  const ui = useUI();
  const [state, setState] = useState<RebalanceState | null>(null);
  const [mode, setMode] = useState<"vorher" | "nachher">("vorher");
  const [detail, setDetail] = useState<{ seg: Segment; account: string } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);

  const load = () =>
    loadRebalance(accounts)
      .then(setState)
      .catch((e) => ui.toast(e instanceof Error ? e.message : String(e), "error"));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  const caps = useMemo(() => toCaps(accounts), [accounts]);
  const showPlan = !!state && state.plan.steps.length > 0 && !state.active && !state.rejected;

  // Regalbretter berechnen (vorher oder nach Ausführung des Vorschlags)
  const shelves = useMemo(() => {
    if (!state) return [];
    const moved = new Map<string, string>(); // unitId → Zielkonto
    if (showPlan) for (const s of state.plan.steps) for (const u of s.units) moved.set(unitId({ account_id: s.from, folder_id: u.folder_id }), s.to);
    return caps.map((a, idx) => {
      const segs = new Map<string, Segment>();
      let inTree = 0;
      for (const u of state.units) {
        const target = moved.get(unitId(u));
        const here = mode === "nachher" && target ? target : u.account_id;
        if (u.account_id === a.id) inTree += u.bytes;
        if (here !== a.id) continue;
        const b = blockOf(u, state.groupFolder);
        const seg = segs.get(b.key) ?? { key: b.key, label: b.label, bytes: 0, files: 0, locked: true, moving: null, units: [] };
        seg.bytes += u.bytes;
        seg.files += u.files;
        seg.units.push(u);
        seg.locked &&= isLocked(u.parent_key, state.locks);
        if (target) seg.moving = mode === "nachher" ? "in" : "out";
        segs.set(b.key, seg);
      }
      const sorted = [...segs.values()].sort((x, y) => y.bytes - x.bytes);
      const top = sorted.slice(0, MAX_SEGMENTS);
      const rest = sorted.slice(MAX_SEGMENTS);
      if (rest.length) {
        top.push({
          key: `${a.id}#rest`,
          label: `${rest.length} weitere Ordner`,
          bytes: rest.reduce((s, x) => s + x.bytes, 0),
          files: rest.reduce((s, x) => s + x.files, 0),
          locked: false,
          moving: rest.some((x) => x.moving) ? (mode === "nachher" ? "in" : "out") : null,
          units: rest.flatMap((x) => x.units),
        });
      }
      const other = Math.max(0, a.usage - inTree); // Nicht-Fotos, Papierkorb, ausserhalb der Ablage
      const used = top.reduce((s, x) => s + x.bytes, 0) + other;
      return { account: a, color: accountColor(accounts.findIndex((x) => x.id === a.id) ?? idx), segs: top, other, used };
    });
  }, [state, caps, mode, showPlan, accounts]);

  const emailOf = (id: string) => accounts.find((a) => a.id === id)?.email ?? "?";
  const colorOf = (id: string) => accountColor(accounts.findIndex((a) => a.id === id));

  const execute = async () => {
    if (!state) return;
    const ok = await ui.confirm({
      title: "Rebalancing ausführen?",
      message: `${state.plan.steps.length} Ordner (${formatBytes(state.plan.bytes)}) werden bei Google kopiert, Prüfsumme und Grösse verglichen und erst dann die Originale in den Papierkorb gelegt. Dort bleiben sie 30 Tage zurückholbar – so lange belegen sie noch Platz im Quellkonto. Du kannst die App schliessen; der Rest läuft nachts weiter.`,
      confirmLabel: "Ausführen",
    });
    if (!ok) return;
    try {
      await savePlan(state.plan, "queued");
      setProgress({ done: 0, total: 0, failed: 0 });
      const r = await runRebalance((p) => {
        const x = p.plans[0];
        if (x) setProgress({ done: x.done, total: x.total, failed: x.failed });
      });
      const x = r.plans[0];
      ui.toast(x && x.failed ? `Fertig – ${x.failed} Fotos fehlgeschlagen (Originale unverändert)` : "Rebalancing fertig", x?.failed ? "error" : "ok");
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setProgress(null);
      void load();
    }
  };

  const resume = async () => {
    setProgress({ done: state?.active?.done ?? 0, total: state?.active?.total ?? 0, failed: state?.active?.failed ?? 0 });
    try {
      await runRebalance((p) => p.plans[0] && setProgress({ done: p.plans[0].done, total: p.plans[0].total, failed: p.plans[0].failed }));
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setProgress(null);
      void load();
    }
  };

  const reject = async () => {
    if (!state) return;
    await savePlan(state.plan, "rejected").catch((e) => ui.toast(String(e), "error"));
    ui.toast("Vorschlag abgelehnt – er erscheint erst wieder, wenn sich etwas ändert", "info");
    void load();
  };

  // Sperren (Regel 7): bei einem Gruppenblock alle seine Unterordner der ersten Ebene
  const lockKeys = (seg: Segment) => {
    if (!seg.key.includes("#") || !state?.groupFolder) return [seg.key];
    const g = state.groupFolder;
    return [...new Set(seg.units.map((u) => `${g}/${u.parent_key.slice(g.length + 1).split("/")[0]}`))];
  };
  const toggleLock = async (seg: Segment) => {
    const keys = lockKeys(seg);
    try {
      for (const k of keys) await setLock(k, !seg.locked);
      ui.toast(seg.locked ? "Entsperrt" : "Gesperrt – wird nie verschoben", "ok");
      setDetail(null);
      void load();
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  // Gruppenregel (Regel 5): Ordner mit vielen Unterordnern als Kandidaten
  const groupCandidates = useMemo(() => {
    if (!state) return [];
    const kids = new Map<string, { path: string; children: Set<string>; bytes: number }>();
    for (const u of state.units) {
      const segs = u.path.split("/");
      for (let i = 1; i < segs.length; i++) {
        const parent = segs.slice(0, i).join("/");
        const c = kids.get(parent.toLowerCase()) ?? { path: parent, children: new Set(), bytes: 0 };
        c.children.add(segs[i].toLowerCase());
        c.bytes += u.bytes;
        kids.set(parent.toLowerCase(), c);
      }
    }
    return [...kids.entries()]
      .filter(([, c]) => c.children.size >= 4)
      .sort((x, y) => y[1].bytes - x[1].bytes)
      .slice(0, 4)
      .map(([key, c]) => ({ key, path: c.path, children: c.children.size, bytes: c.bytes }));
  }, [state]);

  const chooseGroup = async (key: string | null) => {
    await saveGroupFolder(key).catch((e) => ui.toast(String(e), "error"));
    void load();
  };

  const freeDate = new Date(Date.now() + 30 * 864e5);
  const history = (state?.plans ?? []).filter((p) => p.status === "done" || p.status === "failed").slice(0, 5);

  return (
    <div className="view page-forward">
      <Topbar
        eyebrow="Rebalancing"
        title="Regal"
        left={
          <button className="icon-btn" onClick={() => navigate("mehr")} aria-label="Zurück">
            <Icon name="chevronLeft" />
          </button>
        }
      />

      {!state ? (
        <LineSkeleton count={8} />
      ) : (
        <>
          {/* Laufende Ausführung */}
          {(progress || state.active) && (
            <section className="card glass enter rb-run">
              <div className="row between">
                <strong>Rebalancing läuft</strong>
                <span className="muted small">
                  {(progress ?? state.active)!.done} / {(progress ?? state.active)!.total || "…"}
                </span>
              </div>
              <div className="bar">
                <div
                  className="bar-fill"
                  style={{ width: `${(100 * ((progress ?? state.active)!.done || 0)) / Math.max(1, (progress ?? state.active)!.total || 1)}%` }}
                />
              </div>
              <p className="faint small">
                Kopieren bei Google → Prüfsumme vergleichen → Original in den Papierkorb. Du kannst die App schliessen, der nächtliche Job macht weiter.
              </p>
              {!progress && (
                <button className="btn primary block" onClick={resume}>
                  Jetzt weiter ausführen
                </button>
              )}
            </section>
          )}

          {/* Vorschlag */}
          {showPlan ? (
            <section className="card glass enter rb-plan">
              <div className="row between">
                <strong>Vorschlag</strong>
                <span className="chip-lite">{formatBytes(state.plan.bytes)}</span>
              </div>
              <ul className="rb-steps">
                {state.plan.steps.map((s) => (
                  <li key={s.block + s.from}>
                    <span className="rb-swatch" style={{ ["--h" as string]: folderHue(s.label) }} />
                    <span className="rb-step-text">
                      <span className="ellipsis" style={{ fontWeight: 600 }}>{s.label}</span>
                      <span className="faint small">
                        {s.reason === "zusammenführen" ? "Zusammenführen" : "Entlasten"} · {s.files.toLocaleString("de-CH")} Fotos · {formatBytes(s.bytes)}
                      </span>
                      <span className="rb-route small">
                        <span className="dot" style={{ background: colorOf(s.from) }} />
                        <span className="ellipsis">{emailOf(s.from)}</span>
                        <Icon name="chevronRight" size={14} />
                        <span className="dot" style={{ background: colorOf(s.to) }} />
                        <span className="ellipsis">{emailOf(s.to)}</span>
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="faint small">
                Der Platz im Quellkonto wird frei, sobald Google den Papierkorb leert – spätestens am {freeDate.toLocaleDateString("de-CH")}.
              </p>
              <div className="row" style={{ gap: 10 }}>
                <button className="btn ghost" style={{ flex: 1 }} onClick={reject}>
                  Ablehnen
                </button>
                <button className="btn primary" style={{ flex: 2 }} onClick={execute} disabled={!!progress}>
                  <Icon name="move" size={18} /> Ausführen
                </button>
              </div>
            </section>
          ) : (
            !state.active &&
            !progress && (
              <section className="card glass enter rb-ok">
                <span className="rb-ok-icon">
                  <Icon name="checkCircle" size={22} />
                </span>
                <span>
                  <strong>{state.rejected ? "Vorschlag abgelehnt" : "Alles ausgeglichen"}</strong>
                  <span className="faint small" style={{ display: "block" }}>
                    {state.rejected ? "Er erscheint wieder, sobald sich die Lage ändert." : "Kein Konto ist zu voll, keine Ordner sind unnötig verteilt."}
                  </span>
                </span>
              </section>
            )
          )}

          {/* Regal */}
          <div className="section-title">
            <span>Konten</span>
            {showPlan && (
              <Segmented
                options={[
                  { value: "vorher", label: "Jetzt" },
                  { value: "nachher", label: "Danach" },
                ]}
                value={mode}
                onChange={setMode}
              />
            )}
          </div>
          <div className="shelves stagger">
            {shelves.map((sh, i) => (
              <section key={sh.account.id} className="card glass shelf" style={{ ["--i" as string]: i }}>
                <div className="row between small">
                  <span className="row" style={{ gap: 8, minWidth: 0 }}>
                    <span className="dot" style={{ background: sh.color }} />
                    <span className="ellipsis" style={{ fontWeight: 600 }}>{sh.account.email}</span>
                  </span>
                  <span className="muted" style={{ flexShrink: 0 }}>
                    {formatBytes(sh.used)} / {formatBytes(sh.account.limit)}
                  </span>
                </div>
                <div className="shelf-bar" role="img" aria-label={`${sh.account.email}: ${formatBytes(sh.used)} belegt`}>
                  {sh.segs.map((s) => (
                    <button
                      key={s.key}
                      className={`seg ${s.locked ? "locked" : ""} ${s.moving ?? ""}`}
                      style={{ width: `${Math.max(1.2, (100 * s.bytes) / sh.account.limit)}%`, ["--h" as string]: folderHue(s.label) }}
                      onClick={() => setDetail({ seg: s, account: sh.account.id })}
                      aria-label={`${s.label}, ${formatBytes(s.bytes)}`}
                    >
                      {s.locked && <Icon name="lock" size={11} />}
                    </button>
                  ))}
                  {sh.other > 0 && <span className="seg other" style={{ width: `${(100 * sh.other) / sh.account.limit}%` }} title="Sonstiges" />}
                  <span className="seg free" />
                </div>
                <div className="shelf-legend">
                  {sh.segs.slice(0, 4).map((s) => (
                    <button key={s.key} className="legend-item" onClick={() => setDetail({ seg: s, account: sh.account.id })}>
                      <span className="rb-swatch" style={{ ["--h" as string]: folderHue(s.label) }} />
                      <span className="ellipsis">{s.label}</span>
                      {s.locked && <Icon name="lock" size={12} />}
                      {s.moving === "in" && <span className="rb-tag in">neu</span>}
                      {s.moving === "out" && <span className="rb-tag out">zieht um</span>}
                      <span className="muted">{formatBytes(s.bytes)}</span>
                    </button>
                  ))}
                  {sh.other > 0 && (
                    <span className="legend-item static">
                      <span className="rb-swatch other" />
                      <span className="ellipsis">Sonstiges (Papierkorb, andere Dateien)</span>
                      <span className="muted">{formatBytes(sh.other)}</span>
                    </span>
                  )}
                </div>
              </section>
            ))}
          </div>

          {/* Einstellungen */}
          <div className="section-title">
            <span>Gruppenregel A–M / N–Z</span>
          </div>
          <section className="card glass">
            <p className="faint small" style={{ marginTop: 0 }}>
              Für einen grossen Ordner: seine Unterordner werden nach Anfangsbuchstaben in zwei Blöcke geteilt, die jeweils möglichst ganz in einem Konto liegen.
            </p>
            <div className="chips" style={{ padding: 0 }}>
              <button className={`chip ${!state.groupFolder ? "on" : ""}`} onClick={() => chooseGroup(null)}>
                Keiner
              </button>
              {groupCandidates.map((c) => (
                <button key={c.key} className={`chip ${state.groupFolder === c.key ? "on" : ""}`} onClick={() => chooseGroup(c.key)}>
                  {c.path} · {c.children}
                </button>
              ))}
            </div>
          </section>

          {state.locks.size > 0 && (
            <>
              <div className="section-title">
                <span>Gesperrte Ordner</span>
                <span>{state.locks.size}</span>
              </div>
              <section className="card glass stack" style={{ gap: 6 }}>
                {[...state.locks].sort().map((k) => (
                  <div key={k} className="row between small">
                    <span className="row ellipsis" style={{ gap: 6 }}>
                      <Icon name="lock" size={14} /> {k}
                    </span>
                    <button className="btn ghost small" onClick={() => setLock(k, false).then(load)}>
                      Entsperren
                    </button>
                  </div>
                ))}
              </section>
            </>
          )}

          {history.length > 0 && (
            <>
              <div className="section-title">
                <span>Verlauf</span>
              </div>
              <section className="card glass stack" style={{ gap: 10 }}>
                {history.map((p) => (
                  <div key={p.id} className="small">
                    <div className="faint">{formatDateTime(p.finished_at ?? p.created_at)}</div>
                    <div>{p.message}</div>
                  </div>
                ))}
              </section>
            </>
          )}
        </>
      )}

      {detail && (
        <>
          <div className="sheet-backdrop" onClick={() => setDetail(null)} />
          <div className="sheet">
            <div className="sheet-grip" />
            <div className="sheet-head">
              <div style={{ minWidth: 0 }}>
                <div className="muted small ellipsis">{emailOf(detail.account)}</div>
                <h2 className="ellipsis">{detail.seg.label}</h2>
              </div>
              <button className="icon-btn" onClick={() => setDetail(null)} aria-label="Schliessen">
                <Icon name="x" />
              </button>
            </div>
            <div className="sheet-body stack">
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <span className="chip-lite">{formatBytes(detail.seg.bytes)}</span>
                <span className="chip-lite">{detail.seg.files.toLocaleString("de-CH")} Fotos</span>
                <span className="chip-lite">{detail.seg.units.length} Ordner</span>
              </div>
              {detail.seg.units.length > 1 && (
                <ul className="names">
                  {detail.seg.units
                    .slice()
                    .sort((x, y) => y.bytes - x.bytes)
                    .slice(0, 8)
                    .map((u) => (
                      <li key={unitId(u)}>
                        {u.path} · {formatBytes(u.bytes)}
                      </li>
                    ))}
                </ul>
              )}
              {!detail.seg.key.endsWith("#rest") && (
                <button className={`btn block ${detail.seg.locked ? "" : "primary"}`} onClick={() => toggleLock(detail.seg)}>
                  <Icon name="lock" size={18} /> {detail.seg.locked ? "Entsperren" : "Sperren – nie verschieben"}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
