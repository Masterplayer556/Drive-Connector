import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon";
import Ring from "../components/Ring";
import { loadFolder } from "../lib/cache";
import { knownMd5, syncAccounts, writeLogs, type LogInput } from "../lib/db";
import { photoDate } from "../lib/exif";
import { formatBytes } from "../lib/format";
import { md5OfFile } from "../lib/md5";
import { childKey } from "../lib/naming";
import { planUpload, summarize, type PlanEntry, type PlanFile } from "../lib/plan";
import type { Account, Crumb } from "../lib/types";
import { executeUpload } from "../lib/upload";

/** Wurzel der automatischen Ablage (Regel 8). */
export const AUTO_ROOT = "Privat/Fotos";

interface Analysed extends PlanFile {
  date: Date;
  dated: boolean;
}

interface Group {
  target: Crumb;
  label: string;
  files: Analysed[];
  plan: PlanEntry[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const monthLabel = new Intl.DateTimeFormat("de-CH", { month: "long", year: "numeric" });

function crumbFor(d: Date): Crumb {
  const path = `${AUTO_ROOT}/${d.getFullYear()}/${pad(d.getMonth() + 1)}`;
  const key = path.split("/").reduce((k, seg) => childKey(k, seg), "");
  return { name: pad(d.getMonth() + 1), path, key };
}

/** Automatische Foto-Ablage: jedes Foto nach Aufnahmedatum in Privat/Fotos/JJJJ/MM. */
export default function AutoUploadSheet({
  files,
  accounts,
  onClose,
}: {
  files: File[];
  accounts: Account[];
  onClose: (changed: boolean) => void;
}) {
  const [phase, setPhase] = useState<"analyse" | "review" | "upload" | "done">("analyse");
  const [analysed, setAnalysed] = useState(0);
  const [groups, setGroups] = useState<Group[]>([]);
  const [conflictMode, setConflictMode] = useState<"skip" | "rename">("skip");
  const [done, setDone] = useState(0);
  const [result, setResult] = useState<{ uploaded: number; failed: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const background = useRef<Promise<unknown> | null>(null);
  const known = useRef<Set<string>>(new Set());
  const contents = useRef(new Map<string, Awaited<ReturnType<typeof loadFolder>> | null>());

  const byId = useMemo(() => new Map(files.map((f, i) => [`f${i}`, f])), [files]);

  // 1. Prüfsumme + Aufnahmedatum, dann Gruppen nach Monat
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list: Analysed[] = [];
        let i = 0;
        for (const [id, f] of byId) {
          if (cancelled) return;
          const [md5, exif] = await Promise.all([md5OfFile(f), photoDate(f)]);
          list.push({ id, name: f.name, size: f.size, md5, date: exif ?? new Date(f.lastModified || Date.now()), dated: !!exif });
          setAnalysed(++i);
        }
        known.current = await knownMd5(list.map((f) => f.md5));
        const byMonth = new Map<string, Analysed[]>();
        for (const f of list) {
          const k = crumbFor(f.date).key;
          byMonth.set(k, [...(byMonth.get(k) ?? []), f]);
        }
        for (const groupFiles of byMonth.values()) {
          const target = crumbFor(groupFiles[0].date);
          contents.current.set(target.key, await loadFolder(target.key).catch(() => null));
        }
        if (cancelled) return;
        setGroups(
          [...byMonth.values()]
            .map((gf) => ({ target: crumbFor(gf[0].date), label: monthLabel.format(gf[0].date), files: gf, plan: [] }))
            .sort((a, b) => b.target.path.localeCompare(a.target.path)),
        );
        setPhase("review");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [byId]);

  // Pläne pro Monat (Duplikate auch über Monate hinweg erkennen)
  const planned = useMemo(() => {
    const seen = new Set(known.current);
    return groups.map((g) => {
      const content = contents.current.get(g.target.key) ?? null;
      const plan = planUpload({
        files: g.files,
        orderMode: false,
        order: [],
        startNumber: 1,
        existingNames: content?.files.map((f) => f.name) ?? [],
        knownMd5: new Set(seen),
        folderBytes: content?.files.reduce((s, f) => s + (f.size ?? 0), 0) ?? 0,
        folderHasSubfolders: (content?.folders.length ?? 0) > 0,
        conflictMode,
        now: new Date(),
      });
      for (const e of plan) if (e.status === "upload") seen.add(e.md5);
      return { ...g, plan };
    });
  }, [groups, conflictMode]);

  const all = planned.flatMap((g) => g.plan);
  const sum = summarize(all);
  const conflicts = summarize(
    planned.flatMap((g) =>
      planUpload({
        files: g.files,
        orderMode: false,
        order: [],
        startNumber: 1,
        existingNames: contents.current.get(g.target.key)?.files.map((f) => f.name) ?? [],
        knownMd5: new Set(),
        folderBytes: 0,
        folderHasSubfolders: true,
        conflictMode: "skip",
        now: new Date(),
      }),
    ),
  ).conflict;
  const undated = groups.flatMap((g) => g.files).filter((f) => !f.dated).length;
  const totalBytes = all.filter((e) => e.status === "upload").reduce((s, e) => s + e.size, 0);

  const start = async () => {
    setPhase("upload");
    let uploaded = 0;
    const failed: string[] = [];
    const logs: LogInput[] = [];
    const touched = new Set<string>();
    // Kontostände zwischen den Monaten mitführen
    let accs = accounts.map((a) => ({ ...a }));
    for (const g of planned) {
      if (!g.plan.some((e) => e.status === "upload")) continue;
      try {
        const r = await executeUpload({
          target: g.target,
          entries: g.plan,
          files: byId,
          accounts: accs,
          onProgress: (p) => setDone(uploaded + p.done),
        });
        uploaded += r.uploaded.length;
        for (const f of r.failed) failed.push(`${f.entry.originalName}: ${f.error}`);
        for (const id of r.accountIds) touched.add(id);
        accs = accs.map((a) => ({
          ...a,
          quota_usage: (a.quota_usage ?? 0) + r.uploaded.filter((u) => u.accountId === a.id).reduce((s, u) => s + u.size, 0),
        }));
        if (r.uploaded.length) {
          logs.push({ kind: "upload", message: `${r.uploaded.length} Foto(s) nach „${g.target.path}“ abgelegt (automatisch)` });
        }
        for (const u of r.uploaded.filter((x) => x.renamed)) {
          logs.push({ kind: "rename", message: `„${u.originalName}“ → „${u.targetName}“ (${u.renamed === "zahlenschutz" ? "Zahlen-Schutz" : "Namenskonflikt"})`, details: { ordner: g.target.path } });
        }
        for (const c of r.createdFolders) logs.push({ kind: "folder", message: `Ordner „${c.path}“ angelegt` });
      } catch (e) {
        failed.push(`${g.label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    background.current = Promise.all([writeLogs(logs), touched.size ? syncAccounts([...touched]) : Promise.resolve()]).catch(
      () => undefined,
    );
    setResult({ uploaded, failed });
    setPhase("done");
  };

  const close = async () => {
    setClosing(true);
    if (background.current) await background.current;
    onClose(phase === "done");
  };

  return (
    <>
      <div className="sheet-backdrop" />
      <div className="sheet">
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div style={{ minWidth: 0 }}>
            <div className="muted small ellipsis">automatisch nach „{AUTO_ROOT}/Jahr/Monat“</div>
            <h2>{phase === "done" ? "Gesichert" : `${files.length} Foto${files.length === 1 ? "" : "s"} sichern`}</h2>
          </div>
          {phase !== "upload" && (
            <button className="icon-btn" onClick={close} disabled={closing} aria-label="Schliessen">
              {closing ? <span className="spinner" /> : <Icon name="x" />}
            </button>
          )}
        </div>
        <div className="sheet-body">
          {error && (
            <div className="banner error" style={{ margin: 0, width: "100%" }}>
              <Icon name="alert" size={18} />
              {error}
            </div>
          )}
          {phase === "analyse" && !error && <Ring value={analysed} total={files.length} label="geprüft" />}

          {phase === "review" && (
            <>
              <div className="stack" style={{ gap: 8 }}>
                {planned.map((g, i) => {
                  const s = summarize(g.plan);
                  return (
                    <div key={g.target.key} className="switch-row glass enter" style={{ animationDelay: `${i * 40}ms` }}>
                      <span className="row" style={{ flexWrap: "nowrap", minWidth: 0 }}>
                        <span className="folder-icon" style={{ ["--h" as string]: (i * 47) % 360 }}>
                          <Icon name="calendar" size={18} />
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <strong style={{ textTransform: "capitalize" }}>{g.label}</strong>
                          <div className="muted small ellipsis">{g.target.path}</div>
                        </span>
                      </span>
                      <span className="small" style={{ textAlign: "right", flexShrink: 0 }}>
                        <b>{s.upload}</b> neu
                        {s.duplicate > 0 && <div className="muted">{s.duplicate} doppelt</div>}
                      </span>
                    </div>
                  );
                })}
              </div>

              {undated > 0 && (
                <div className="banner" style={{ margin: 0, width: "100%" }}>
                  <Icon name="info" size={18} />
                  <span>
                    {undated} Foto{undated === 1 ? "" : "s"} ohne Aufnahmedatum – abgelegt nach Dateidatum.
                  </span>
                </div>
              )}

              {conflicts > 0 && (
                <div className="card glass stack" style={{ margin: 0 }}>
                  <strong>
                    {conflicts} Name{conflicts === 1 ? "" : "n"} gibt es im Monatsordner schon
                  </strong>
                  <label className={`choice ${conflictMode === "skip" ? "on" : ""}`}>
                    <input type="radio" checked={conflictMode === "skip"} onChange={() => setConflictMode("skip")} />
                    Überspringen
                  </label>
                  <label className={`choice ${conflictMode === "rename" ? "on" : ""}`}>
                    <input type="radio" checked={conflictMode === "rename"} onChange={() => setConflictMode("rename")} />
                    Mit „Foto_Datum“-Namen hochladen
                  </label>
                </div>
              )}

              <div className="stat-chips">
                <span className="stat-chip">
                  <b>{sum.upload}</b> neu · {formatBytes(totalBytes)}
                </span>
                {sum.duplicate > 0 && (
                  <span className="stat-chip">
                    <b>{sum.duplicate}</b> schon im Pool
                  </span>
                )}
                {sum.renamed > 0 && (
                  <span className="stat-chip">
                    <b>{sum.renamed}</b> umbenannt
                  </span>
                )}
              </div>

              <button className="btn primary block" disabled={sum.upload === 0} onClick={start}>
                <Icon name="upload" size={19} /> {sum.upload} Foto{sum.upload === 1 ? "" : "s"} sichern
              </button>
            </>
          )}

          {phase === "upload" && (
            <>
              <Ring value={done} total={sum.upload} label="gesichert" />
              <p className="muted small" style={{ textAlign: "center" }}>
                Bitte die App offen lassen – der Bildschirm bleibt an.
              </p>
            </>
          )}

          {phase === "done" && result && (
            <>
              <div className="done-check">
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <h2 style={{ textAlign: "center" }}>
                {result.uploaded} Foto{result.uploaded === 1 ? "" : "s"} gesichert
              </h2>
              {sum.duplicate > 0 && (
                <div className="stat-chips">
                  <span className="stat-chip">
                    <b>{sum.duplicate}</b> waren schon im Pool
                  </span>
                </div>
              )}
              {result.failed.length > 0 && (
                <div className="banner error" style={{ margin: 0, width: "100%", display: "block" }}>
                  <strong>{result.failed.length} fehlgeschlagen</strong>
                  <ul className="names">
                    {result.failed.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
              <button className="btn primary block" onClick={close} disabled={closing}>
                {closing ? <span className="spinner" /> : "Fertig"}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
