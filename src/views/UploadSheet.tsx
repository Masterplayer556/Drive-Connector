import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon";
import PathPicker, { crumbsOf } from "../components/PathPicker";
import Ring from "../components/Ring";
import { ignoreDuplicate, knownMd5, releaseNumbers, reserveNumbers, syncAccounts, writeLogs, type LogInput } from "../lib/db";
import { invalidateFolder, loadFolder } from "../lib/cache";
import { formatBytes } from "../lib/format";
import { md5OfFile } from "../lib/md5";
import { maxNumber } from "../lib/naming";
import { planUpload, summarize, type PlanEntry, type PlanFile, type PlanInput } from "../lib/plan";
import { executeUpload, type UploadProgress, type UploadResult } from "../lib/upload";
import type { Account, Crumb, FolderContent } from "../lib/types";
import { useKeepAwake } from "../lib/wakelock";

type Phase = "analyse" | "review" | "upload" | "done";

/** Ein fertig geprüfter Stapel Fotos für einen Zielordner („Weiter“ merkt ihn vor, „Hochladen“ lädt alle). */
interface Batch {
  byId: Map<string, File>;
  target: Crumb;
  input: PlanInput;
  known: Set<string>;
  /** Anzahl Fotos, die wirklich hochgeladen werden */
  count: number;
}

const plural = (n: number) => `${n} Foto${n === 1 ? "" : "s"}`;

const REASON: Record<string, string> = {
  reihenfolge: "Reihenfolge",
  zahlenschutz: "Zahlen-Schutz",
  konflikt: "Namenskonflikt",
};

export default function UploadSheet({
  files: initialFiles,
  target: initialTarget,
  content: initialContent,
  accounts,
  onClose,
}: {
  files: File[];
  target: Crumb;
  content: FolderContent;
  accounts: Account[];
  onClose: (changed: boolean) => void;
}) {
  const [files, setFiles] = useState<File[]>(initialFiles);
  // „Weitere Fotos in andere Ordner“: vorgemerkte Stapel, die beim Hochladen mitkommen
  const [more, setMore] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [phase, setPhase] = useState<Phase>("analyse");
  useKeepAwake(phase === "analyse" || phase === "upload"); // Bildschirm bleibt an, solange es läuft
  const [analysed, setAnalysed] = useState(0);
  const [planFiles, setPlanFiles] = useState<PlanFile[]>([]);
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [orderMode, setOrderMode] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const [conflictMode, setConflictMode] = useState<"skip" | "rename">("skip");
  const [allowDup, setAllowDup] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [result, setResult] = useState<{ upload: UploadResult; plan: PlanEntry[]; folders: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNames, setShowNames] = useState(false);
  const [closing, setClosing] = useState(false);
  const background = useRef<Promise<unknown> | null>(null);
  // Ziel: standardmässig der Ordner, in dem „Hochladen“ gedrückt wurde – kann geändert werden
  const [target, setTarget] = useState<Crumb>(initialTarget);
  const [content, setContent] = useState<FolderContent | null>(initialContent);
  const [picking, setPicking] = useState(false);
  const [targetsDone, setTargetsDone] = useState<string[]>([]);
  const usedKeys = new Set(batches.map((b) => b.target.key));

  const changeTarget = (c: Crumb) => {
    setPicking(false);
    if (c.key === target.key && content) return;
    setTarget(c);
    setOrder([]);
    setContent(null);
    loadFolder(c.key)
      .then((x) => setContent(x))
      .catch(() => setContent({ folders: [], files: [] }));
  };

  const byId = useMemo(() => new Map(files.map((f, i) => [`f${i}`, f])), [files]);
  const previews = useMemo(() => new Map([...byId].map(([id, f]) => [id, URL.createObjectURL(f)])), [byId]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  // 1. Prüfsummen berechnen und mit dem Pool vergleichen
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list: PlanFile[] = [];
        let i = 0;
        for (const [id, f] of byId) {
          if (cancelled) return;
          list.push({ id, name: f.name, size: f.size, md5: await md5OfFile(f) });
          setAnalysed(++i);
        }
        const k = await knownMd5(list.map((f) => f.md5));
        if (cancelled) return;
        setPlanFiles(list);
        setKnown(k);
        setPhase("review");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [byId]);

  const baseInput: PlanInput = useMemo(
    () => ({
      files: planFiles,
      orderMode,
      order,
      startNumber: maxNumber((content?.files ?? []).map((f) => f.name)) + 1,
      existingNames: (content?.files ?? []).map((f) => f.name),
      knownMd5: known,
      allowPoolDuplicates: allowDup,
      folderMd5: new Set((content?.files ?? []).map((f) => f.md5).filter((m): m is string => !!m)),
      folderBytes: (content?.files ?? []).reduce((s, f) => s + (f.size ?? 0), 0),
      folderHasSubfolders: (content?.folders.length ?? 0) > 0,
      conflictMode,
      now: new Date(),
    }),
    [planFiles, orderMode, order, content, known, conflictMode, allowDup],
  );
  const plan = useMemo(() => planUpload(baseInput), [baseInput]);
  const sum = summarize(plan);
  const conflictsWithoutRename = useMemo(
    () => summarize(planUpload({ ...baseInput, conflictMode: "skip" })).conflict,
    [baseInput],
  );

  const toggleOrder = (id: string) =>
    setOrder((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));

  const snapshot = (): Batch => ({ byId, target, input: baseInput, known, count: sum.upload });

  /** „Weiter“: aktuellen Stapel vormerken und mit neuen Fotos von vorne beginnen (anderer Ordner). */
  const next = (list: File[]) => {
    if (!list.length) return;
    if (sum.upload > 0) setBatches((b) => [...b, snapshot()]);
    setFiles(list);
    setPhase("analyse");
    setAnalysed(0);
    setPlanFiles([]);
    setKnown(new Set());
    setOrderMode(false);
    setOrder([]);
    setAllowDup(false);
    setShowNames(false);
    setPicking(true); // gleich den Zielordner wählen – die Prüfung läuft solange im Hintergrund
  };

  /** Einen Stapel hochladen; Protokoll + Index laufen danach im Hintergrund weiter. */
  const runBatch = async (b: Batch, onProgress: (p: UploadProgress) => void) => {
    let reserved: number[] = [];
    try {
      const numbered = summarize(planUpload(b.input)).numbered;
      let finalPlan: PlanEntry[];
      if (b.input.orderMode && numbered > 0) {
        const first = await reserveNumbers(b.target.key, numbered);
        reserved = Array.from({ length: numbered }, (_, i) => first + i);
        finalPlan = planUpload({ ...b.input, startNumber: first, now: new Date() });
      } else {
        finalPlan = planUpload({ ...b.input, now: new Date() });
      }

      const upload = await executeUpload({ target: b.target, entries: finalPlan, files: b.byId, accounts, onProgress });

      const s = summarize(finalPlan);
      const emailOf = (id: string) => accounts.find((a) => a.id === id)?.email ?? id;
      const logs: LogInput[] = [
        {
          kind: "upload",
          message: `${upload.uploaded.length} Foto(s) nach „${b.target.path}“ hochgeladen`,
          details: {
            duplikate: s.duplicate,
            konflikte: s.conflict,
            blockiert: s.limit,
            fehler: upload.failed.map((f) => `${f.entry.originalName}: ${f.error}`),
            konten: upload.accountIds.map(emailOf),
          },
        },
        ...upload.uploaded
          .filter((u) => u.renamed)
          .map((u) => ({
            kind: "rename" as const,
            message: `„${u.originalName}“ → „${u.targetName}“ (${REASON[u.renamed!]})`,
            details: { ordner: b.target.path },
          })),
        ...upload.createdFolders.map((c) => ({
          kind: "folder" as const,
          message: `Ordner „${c.path}“ in ${emailOf(c.accountId)} angelegt`,
        })),
      ];
      if (s.limit > 0) {
        logs.push({
          kind: "error",
          message: `Ordner „${b.target.path}“ hat 15 GB erreicht – ${s.limit} Foto(s) nicht hochgeladen`,
        });
      }

      const toRelease = reserved;
      reserved = [];
      // Bewusst doppelt hochgeladene Fotos gleich als „bewusst behalten“ markieren (nach dem Abgleich)
      const intended = [...new Set(upload.uploaded.filter((u) => b.known.has(u.md5)).map((u) => u.md5))];
      const bg = Promise.all([
        writeLogs(logs),
        (upload.accountIds.length ? syncAccounts(upload.accountIds) : Promise.resolve()).then(() =>
          Promise.all(intended.map((m) => ignoreDuplicate(m).catch(() => undefined))),
        ),
      ])
        .catch(() => undefined)
        .finally(() => releaseNumbers(b.target.key, toRelease).catch(() => undefined));
      return { upload, plan: finalPlan, bg };
    } catch (e) {
      await releaseNumbers(b.target.key, reserved).catch(() => undefined);
      throw e;
    }
  };

  const start = async () => {
    setPhase("upload");
    setError(null);
    const all = [...batches, snapshot()].filter((b) => b.count > 0);
    const total = all.reduce((n, b) => n + b.count, 0);
    const merged: UploadResult = { uploaded: [], failed: [], accountIds: [], createdFolders: [] };
    const plans: PlanEntry[] = [];
    const bgs: Promise<unknown>[] = [];
    let before = { done: 0, failed: 0 };
    try {
      for (const b of all) {
        const r = await runBatch(b, (p) => setProgress({ done: before.done + p.done, failed: before.failed + p.failed, total }));
        merged.uploaded.push(...r.upload.uploaded);
        merged.failed.push(...r.upload.failed);
        merged.accountIds = [...new Set([...merged.accountIds, ...r.upload.accountIds])];
        merged.createdFolders.push(...r.upload.createdFolders);
        plans.push(...r.plan);
        bgs.push(r.bg);
        before = { done: merged.uploaded.length, failed: merged.failed.length };
      }
      setResult({ upload: merged, plan: plans, folders: all.length });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (merged.uploaded.length || merged.failed.length) setResult({ upload: merged, plan: plans, folders: all.length });
    } finally {
      background.current = Promise.all(bgs);
      setTargetsDone(all.map((b) => b.target.key));
      setPhase("done");
    }
  };

  const close = async () => {
    setClosing(true);
    if (background.current) await background.current;
    if (phase === "done") {
      // Zielordner und ihre Eltern (evtl. neu angelegt) neu laden
      for (const key of targetsDone) {
        const segs = key.split("/");
        for (let i = 0; i <= segs.length; i++) invalidateFolder(segs.slice(0, i).join("/"));
      }
    }
    onClose(phase === "done");
  };

  if (picking) {
    return (
      <PathPicker
        subtitle="Hochladen nach …"
        start={crumbsOf(target.path)}
        allowNew
        check={(c) => (!c.key ? "Wähle einen Ordner" : usedKeys.has(c.key) ? "Ist schon vorgemerkt – dorthin geht ein Stapel" : null)}
        confirmLabel={(c) => (c.key ? `Nach „${c.name}“ hochladen` : "Ordner wählen")}
        onPick={changeTarget}
        onCancel={() => {
          setPicking(false);
          // Noch kein gültiger Ordner für diesen Stapel? Dann den vorgemerkten Ordner nicht doppelt nehmen
          if (usedKeys.has(target.key)) setContent(null);
        }}
      />
    );
  }

  const totalBytes = plan.filter((e) => e.status === "upload").reduce((s, e) => s + e.size, 0);
  const done = result ? summarize(result.plan) : null;
  const renamedCount = result ? result.upload.uploaded.filter((u) => u.renamed && u.renamed !== "reihenfolge").length : 0;

  return (
    <>
      <div className="sheet-backdrop" />
      <div className="sheet">
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div style={{ minWidth: 0 }}>
            {phase === "analyse" || phase === "review" ? (
              <button className="target-btn" onClick={() => setPicking(true)} aria-label="Zielordner ändern">
                <Icon name="folder" size={14} />
                <span className="ellipsis">nach „{target.path}“</span>
                <Icon name="chevronRight" size={14} />
              </button>
            ) : (
              <div className="muted small ellipsis">
                {result && result.folders > 1 ? `in ${result.folders} Ordner` : batches.length && phase === "upload" ? `in ${batches.length + 1} Ordner` : `nach „${target.path}“`}
              </div>
            )}
            <h2>
              {phase === "analyse" && "Fotos prüfen"}
              {phase === "review" && plural(files.length)}
              {phase === "upload" && "Lade hoch"}
              {phase === "done" && "Fertig"}
            </h2>
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

          {(phase === "analyse" || phase === "review") && batches.length > 0 && (
            <div className="card glass stack" style={{ margin: 0, gap: 6 }}>
              <strong className="small">Schon vorgemerkt</strong>
              {batches.map((b, i) => (
                <div key={b.target.key} className="row" style={{ gap: 8, minWidth: 0 }}>
                  <Icon name="folder" size={14} />
                  <span className="ellipsis small" style={{ flex: 1 }}>
                    {b.target.path}
                  </span>
                  <span className="faint small">{plural(b.count)}</span>
                  <button
                    className="icon-btn"
                    style={{ width: 28, height: 28 }}
                    onClick={() => setBatches((x) => x.filter((_, j) => j !== i))}
                    aria-label={`Vormerkung für ${b.target.path} entfernen`}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {phase === "review" && usedKeys.has(target.key) && (
            <div className="banner warn" style={{ margin: 0, width: "100%" }}>
              <Icon name="alert" size={18} />
              <span>In „{target.path}“ geht schon ein vorgemerkter Stapel – wähle oben einen anderen Ordner.</span>
            </div>
          )}

          {phase === "review" && (
            <>
              <label className="switch-row glass">
                <span>
                  <strong>Reihenfolge festlegen</strong>
                  <div className="muted small">
                    {orderMode ? `Nummern ab ${baseInput.startNumber}` : "Fotos der Reihe nach nummerieren"}
                  </div>
                </span>
                <span className="switch">
                  <input
                    type="checkbox"
                    checked={orderMode}
                    onChange={(e) => {
                      setOrderMode(e.target.checked);
                      setOrder([]);
                    }}
                  />
                  <span />
                </span>
              </label>

              {orderMode && (
                <div className="stack" style={{ gap: 8 }}>
                  <span className="muted small">
                    Tippe die Fotos in der gewünschten Reihenfolge an ({order.filter((id) => plan.find((e) => e.id === id)?.status === "upload").length}/{sum.numbered} gewählt).
                  </span>
                  <div className="row">
                    <button className="btn small" onClick={() => setOrder(planFiles.map((f) => f.id))}>
                      Alle der Reihe nach
                    </button>
                    {order.length > 0 && (
                      <button className="btn small ghost" onClick={() => setOrder([])}>
                        Zurücksetzen
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="grid stagger">
                {planFiles.map((f, i) => {
                  const entry = plan.find((e) => e.id === f.id)!;
                  const pos = order.indexOf(f.id);
                  return (
                    <button
                      key={f.id}
                      className={`cell ${entry.status !== "upload" ? "dimmed" : ""} ${pos >= 0 ? "selected" : ""}`}
                      style={{ ["--i" as string]: i }}
                      onClick={() => orderMode && entry.status === "upload" && toggleOrder(f.id)}
                    >
                      <div className="thumb-wrap">
                        <img className="thumb loaded" src={previews.get(f.id)} alt={f.name} />
                        {entry.status === "duplicate" && <span className="tag">Duplikat</span>}
                        {entry.status === "conflict" && <span className="tag">Konflikt</span>}
                        {entry.status === "limit" && <span className="tag">15 GB</span>}
                      </div>
                      {orderMode && pos >= 0 && <span className="badge">{pos + 1}</span>}
                      <span className="cell-name">{entry.targetName}</span>
                    </button>
                  );
                })}
              </div>

              {(sum.duplicate > 0 || allowDup) && (
                <label className="switch-row glass">
                  <span>
                    <strong>Duplikate trotzdem hochladen</strong>
                    <div className="muted small">
                      Für Fotos, die thematisch auch hierhin gehören. Was schon in diesem Ordner liegt, wird nie doppelt hochgeladen.
                    </div>
                  </span>
                  <span className="switch">
                    <input type="checkbox" checked={allowDup} onChange={(e) => setAllowDup(e.target.checked)} />
                    <span />
                  </span>
                </label>
              )}

              {conflictsWithoutRename > 0 && !orderMode && (
                <div className="card glass stack" style={{ margin: 0 }}>
                  <strong>
                    {conflictsWithoutRename} Name{conflictsWithoutRename === 1 ? "" : "n"} gibt es hier schon
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

              {sum.limit > 0 && (
                <div className="banner warn" style={{ margin: 0, width: "100%" }}>
                  <Icon name="alert" size={18} />
                  <span>
                    Dieser Ordner hat keine Unterordner und erreicht 15 GB. {sum.limit} Foto(s) werden nicht hochgeladen –
                    bitte teile den Ordner selbst auf.
                  </span>
                </div>
              )}

              <div className="stat-chips">
                <span className="stat-chip">
                  <b>{sum.upload}</b> neu · {formatBytes(totalBytes)}
                </span>
                {sum.duplicate > 0 && (
                  <span className="stat-chip">
                    <b>{sum.duplicate}</b> Duplikate
                  </span>
                )}
                {sum.renamed > 0 && (
                  <span className="stat-chip">
                    <b>{sum.renamed}</b> umbenannt
                  </span>
                )}
                {sum.numbered > 0 && (
                  <span className="stat-chip">
                    <b>{sum.numbered}</b> nummeriert
                  </span>
                )}
                {sum.conflict > 0 && (
                  <span className="stat-chip">
                    <b>{sum.conflict}</b> übersprungen
                  </span>
                )}
              </div>

              <button className="link small" style={{ alignSelf: "center" }} onClick={() => setShowNames((s) => !s)}>
                {showNames ? "Namen ausblenden" : "Neue Namen anzeigen"}
              </button>
              {showNames && (
                <ul className="names">
                  {plan
                    .filter((e) => e.status === "upload")
                    .map((e) => (
                      <li key={e.id}>
                        {e.originalName === e.targetName ? e.targetName : `${e.originalName} → ${e.targetName}`}
                      </li>
                    ))}
                </ul>
              )}

              {more ? (
                <label className={`btn primary block ${!content || usedKeys.has(target.key) ? "disabled" : ""}`}>
                  Weiter – Fotos für einen anderen Ordner <Icon name="chevronRight" size={19} />
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    hidden
                    disabled={!content || usedKeys.has(target.key)}
                    onChange={(e) => {
                      const list = e.target.files ? [...e.target.files] : [];
                      e.target.value = "";
                      next(list);
                    }}
                  />
                </label>
              ) : (
                <button
                  className="btn primary block"
                  disabled={sum.upload + batches.reduce((n, b) => n + b.count, 0) === 0 || !content || usedKeys.has(target.key)}
                  onClick={start}
                >
                  <Icon name="upload" size={19} />{" "}
                  {batches.length
                    ? `${plural(sum.upload + batches.reduce((n, b) => n + b.count, 0))} in ${batches.length + 1} Ordner hochladen`
                    : `${plural(sum.upload)} hochladen`}
                </button>
              )}

              <label className="check-row">
                <input type="checkbox" checked={more} onChange={(e) => setMore(e.target.checked)} />
                <span>
                  Noch Fotos für andere Ordner hinzufügen
                  <span className="faint small"> – „Weiter“ merkt diese hier vor, am Schluss wird alles zusammen hochgeladen</span>
                </span>
              </label>
            </>
          )}

          {phase === "upload" && (
            <>
              <Ring value={progress?.done ?? 0} total={progress?.total ?? sum.upload} label="hochgeladen" />
              {progress && progress.failed > 0 && (
                <p className="error small" style={{ textAlign: "center" }}>
                  {progress.failed} Fehler
                </p>
              )}
              <p className="muted small" style={{ textAlign: "center" }}>
                Bitte die App offen lassen – der Bildschirm bleibt an.
              </p>
            </>
          )}

          {phase === "done" && result && done && (
            <>
              <div className="done-check">
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <h2 style={{ textAlign: "center" }}>
                {plural(result.upload.uploaded.length)} hochgeladen
                {result.folders > 1 && <div className="muted small">in {result.folders} Ordner</div>}
              </h2>
              <div className="stat-chips">
                {done.duplicate > 0 && (
                  <span className="stat-chip">
                    <b>{done.duplicate}</b> Duplikate übersprungen
                  </span>
                )}
                {renamedCount > 0 && (
                  <span className="stat-chip">
                    <b>{renamedCount}</b> umbenannt
                  </span>
                )}
                {done.conflict > 0 && (
                  <span className="stat-chip">
                    <b>{done.conflict}</b> Konflikte übersprungen
                  </span>
                )}
                {done.limit > 0 && (
                  <span className="stat-chip">
                    <b>{done.limit}</b> blockiert (15 GB)
                  </span>
                )}
              </div>
              {result.upload.failed.length > 0 && (
                <div className="banner error" style={{ margin: 0, width: "100%", display: "block" }}>
                  <strong>{result.upload.failed.length} fehlgeschlagen</strong>
                  <ul className="names">
                    {result.upload.failed.map((f) => (
                      <li key={f.entry.id}>
                        {f.entry.originalName}: {f.error}
                      </li>
                    ))}
                  </ul>
                  Wähle die Fotos einfach nochmals aus – bereits hochgeladene werden übersprungen.
                </div>
              )}
              <button className="btn primary block" onClick={close} disabled={closing}>
                {closing ? <span className="spinner" /> : "Fertig"}
              </button>
            </>
          )}

          {phase === "done" && !result && (
            <button className="btn primary block" onClick={close} disabled={closing}>
              Schliessen
            </button>
          )}
        </div>
      </div>
    </>
  );
}
