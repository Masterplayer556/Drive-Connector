import { useEffect, useMemo, useRef, useState } from "react";
import { addMedia, countMedia, isVideo, mediaCount, type MediaCount } from "../lib/media";
import Icon from "../components/Icon";
import Ring from "../components/Ring";
import { loadFolder } from "../lib/cache";
import { knownMd5, syncAccounts, writeLogs, type LogInput } from "../lib/db";
import { byCaptureTime, captureDate } from "../lib/exif";
import { formatBytes } from "../lib/format";
import { md5OfFile } from "../lib/md5";
import { localLook, lookDuplicates, rememberLooks, type LocalFile } from "../lib/lookUpload";
import { childKey } from "../lib/naming";
import { planUpload, summarize, type PlanEntry, type PlanFile } from "../lib/plan";
import type { Account, Crumb } from "../lib/types";
import type { FailedUpload } from "../lib/retryUpload";
import { executeUpload, retryFailedUploads } from "../lib/upload";
import { useKeepAwake } from "../lib/wakelock";

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
  useKeepAwake(phase === "analyse" || phase === "upload"); // Bildschirm bleibt an, solange es läuft
  const [analysed, setAnalysed] = useState(0);
  const [groups, setGroups] = useState<Group[]>([]);
  const [conflictMode, setConflictMode] = useState<"skip" | "rename">("skip");
  const [done, setDone] = useState(0);
  const [result, setResult] = useState<{ uploaded: number; failed: FailedUpload[]; media: MediaCount } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const background = useRef<Promise<unknown> | null>(null);
  const known = useRef<Set<string>>(new Set());
  const contents = useRef(new Map<string, Awaited<ReturnType<typeof loadFolder>> | null>());
  /** Sieht gleich aus wie ein Foto im Monatsordner (andere Datei, z. B. HEIC ↔ JPEG) */
  const lookDup = useRef(new Set<string>());

  const byId = useMemo(() => new Map(files.map((f, i) => [`f${i}`, f])), [files]);

  // 1. Prüfsumme + Aufnahmedatum, dann Gruppen nach Monat
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list: Analysed[] = [];
        const locals = new Map<string, LocalFile>();
        let i = 0;
        for (const [id, f] of byId) {
          if (cancelled) return;
          const [md5, exif, look] = await Promise.all([md5OfFile(f), captureDate(f), localLook(f)]);
          list.push({ id, name: f.name, size: f.size, md5, date: exif ?? new Date(f.lastModified || Date.now()), dated: !!exif });
          locals.set(id, { id, file: f, md5, look });
          setAnalysed(++i);
        }
        known.current = await knownMd5(list.map((f) => f.md5));
        rememberLooks([...locals.values()]);
        const byMonth = new Map<string, Analysed[]>();
        // Innerhalb des Monats wie in der Fotos-App: nach Aufnahmezeit (Videos bleiben unten)
        const sorted = byCaptureTime(list, (f) => (f.dated ? f.date.getTime() : null), (f) => isVideo(byId.get(f.id)!));
        for (const f of sorted) {
          const k = crumbFor(f.date).key;
          byMonth.set(k, [...(byMonth.get(k) ?? []), f]);
        }
        for (const groupFiles of byMonth.values()) {
          const target = crumbFor(groupFiles[0].date);
          const content = await loadFolder(target.key).catch(() => null);
          contents.current.set(target.key, content);
          // Gleich aussehende Fotos im selben Monatsordner (dort landet dasselbe Foto wieder – gleiches Aufnahmedatum)
          const found = await lookDuplicates(
            groupFiles.map((g) => locals.get(g.id)!),
            content?.files ?? [],
          ).catch(() => new Map<string, string>());
          for (const id of found.keys()) lookDup.current.add(id);
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
        lookDup: lookDup.current,
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
  const filesOf = (ids: string[]) => ids.map((id) => byId.get(id)).filter((f): f is File => !!f);
  const upMedia = countMedia(filesOf(all.filter((e) => e.status === "upload").map((e) => e.id)));
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
    const uploadedIds: string[] = [];
    const failed: FailedUpload[] = [];
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
        uploadedIds.push(...r.uploaded.map((u) => u.id));
        for (const f of r.failed) failed.push({ ...f, target: g.target, files: byId });
        for (const id of r.accountIds) touched.add(id);
        accs = accs.map((a) => ({
          ...a,
          quota_usage: (a.quota_usage ?? 0) + r.uploaded.filter((u) => u.accountId === a.id).reduce((s, u) => s + u.size, 0),
        }));
        if (r.uploaded.length) {
          logs.push({ kind: "upload", message: `${mediaCount(countMedia(filesOf(r.uploaded.map((u) => u.id))), "Fotos/Videos")} nach „${g.target.path}“ abgelegt (automatisch)` });
        }
        for (const u of r.uploaded.filter((x) => x.renamed)) {
          logs.push({ kind: "rename", message: `„${u.originalName}“ → „${u.targetName}“ (${u.renamed === "zahlenschutz" ? "Zahlen-Schutz" : "Namenskonflikt"})`, details: { ordner: g.target.path } });
        }
        for (const c of r.createdFolders) logs.push({ kind: "folder", message: `Ordner „${c.path}“ angelegt` });
      } catch (e) {
        // Ganzer Monat gescheitert (z. B. kurz offline): alle seine Fotos lassen sich nochmals versuchen
        const error = e instanceof Error ? e.message : String(e);
        for (const entry of g.plan.filter((x) => x.status === "upload")) failed.push({ entry, error, target: g.target, files: byId });
      }
    }
    background.current = Promise.all([writeLogs(logs), touched.size ? syncAccounts([...touched]) : Promise.resolve()]).catch(
      () => undefined,
    );
    setResult({ uploaded, failed, media: countMedia(filesOf(uploadedIds)) });
    setPhase("done");
  };

  /** Nur die fehlgeschlagenen Fotos nochmals sichern (sie sind noch im Speicher). */
  const retry = async () => {
    if (!result || !result.failed.length) return;
    const items = result.failed;
    setPhase("upload");
    setDone(0);
    try {
      if (background.current) await background.current;
      const r = await retryFailedUploads({ items, accounts, onProgress: (p) => setDone(p.done) });
      const logs: LogInput[] = [];
      for (const path of new Set(r.uploaded.map((u) => u.target.path))) {
        const here = r.uploaded.filter((u) => u.target.path === path);
        logs.push({ kind: "upload", message: `${mediaCount(countMedia(filesOf(here.map((u) => u.id))), "Fotos/Videos")} nach „${path}“ abgelegt (automatisch, nochmals versucht)` });
      }
      for (const c of r.createdFolders) logs.push({ kind: "folder", message: `Ordner „${c.path}“ angelegt` });
      background.current = Promise.all([writeLogs(logs), r.accountIds.length ? syncAccounts(r.accountIds) : Promise.resolve()]).catch(
        () => undefined,
      );
      const ok = [...r.uploaded, ...r.present].map((u) => u.id);
      setResult({ uploaded: result.uploaded + ok.length, failed: r.failed, media: addMedia(result.media, countMedia(filesOf(ok))) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase("done");
    }
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
            <h2>{phase === "done" ? "Gesichert" : `${mediaCount(countMedia(files))} sichern`}</h2>
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
                <Icon name="upload" size={19} /> {mediaCount(upMedia)} sichern
              </button>
            </>
          )}

          {phase === "upload" && (
            <>
              <Ring value={done} total={result ? result.failed.length : sum.upload} label="gesichert" />
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
                {mediaCount(result.media)} gesichert
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
                      <li key={f.entry.id}>
                        {f.entry.originalName}: {f.error}
                      </li>
                    ))}
                  </ul>
                  <button className="btn block" style={{ marginTop: 10 }} onClick={retry} disabled={closing}>
                    <Icon name="upload" size={17} /> {result.failed.length === 1 ? "Fehlgeschlagenes" : `${result.failed.length} fehlgeschlagene`}{" "}
                    nochmals sichern
                  </button>
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
