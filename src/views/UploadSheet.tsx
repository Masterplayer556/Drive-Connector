import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon";
import Ring from "../components/Ring";
import { knownMd5, releaseNumbers, reserveNumbers, syncAccounts, writeLogs, type LogInput } from "../lib/db";
import { formatBytes } from "../lib/format";
import { md5OfFile } from "../lib/md5";
import { maxNumber } from "../lib/naming";
import { planUpload, summarize, type PlanEntry, type PlanFile, type PlanInput } from "../lib/plan";
import { executeUpload, type UploadProgress, type UploadResult } from "../lib/upload";
import type { Account, Crumb, FolderContent } from "../lib/types";

type Phase = "analyse" | "review" | "upload" | "done";

const REASON: Record<string, string> = {
  reihenfolge: "Reihenfolge",
  zahlenschutz: "Zahlen-Schutz",
  konflikt: "Namenskonflikt",
};

export default function UploadSheet({
  files,
  target,
  content,
  accounts,
  onClose,
}: {
  files: File[];
  target: Crumb;
  content: FolderContent;
  accounts: Account[];
  onClose: (changed: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("analyse");
  const [analysed, setAnalysed] = useState(0);
  const [planFiles, setPlanFiles] = useState<PlanFile[]>([]);
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [orderMode, setOrderMode] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const [conflictMode, setConflictMode] = useState<"skip" | "rename">("skip");
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [result, setResult] = useState<{ upload: UploadResult; plan: PlanEntry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNames, setShowNames] = useState(false);
  const [closing, setClosing] = useState(false);
  const background = useRef<Promise<unknown> | null>(null);

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
      startNumber: maxNumber(content.files.map((f) => f.name)) + 1,
      existingNames: content.files.map((f) => f.name),
      knownMd5: known,
      folderBytes: content.files.reduce((s, f) => s + (f.size ?? 0), 0),
      folderHasSubfolders: content.folders.length > 0,
      conflictMode,
      now: new Date(),
    }),
    [planFiles, orderMode, order, content, known, conflictMode],
  );
  const plan = useMemo(() => planUpload(baseInput), [baseInput]);
  const sum = summarize(plan);
  const conflictsWithoutRename = useMemo(
    () => summarize(planUpload({ ...baseInput, conflictMode: "skip" })).conflict,
    [baseInput],
  );

  const toggleOrder = (id: string) =>
    setOrder((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));

  const start = async () => {
    setPhase("upload");
    setError(null);
    let reserved: number[] = [];
    try {
      let finalPlan: PlanEntry[];
      if (orderMode && sum.numbered > 0) {
        const first = await reserveNumbers(target.key, sum.numbered);
        reserved = Array.from({ length: sum.numbered }, (_, i) => first + i);
        finalPlan = planUpload({ ...baseInput, startNumber: first, now: new Date() });
      } else {
        finalPlan = planUpload({ ...baseInput, now: new Date() });
      }

      const upload = await executeUpload({
        target,
        entries: finalPlan,
        files: byId,
        accounts,
        onProgress: setProgress,
      });

      const s = summarize(finalPlan);
      const emailOf = (id: string) => accounts.find((a) => a.id === id)?.email ?? id;
      const logs: LogInput[] = [
        {
          kind: "upload",
          message: `${upload.uploaded.length} Foto(s) nach „${target.path}“ hochgeladen`,
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
            details: { ordner: target.path },
          })),
        ...upload.createdFolders.map((c) => ({
          kind: "folder" as const,
          message: `Ordner „${c.path}“ in ${emailOf(c.accountId)} angelegt`,
        })),
      ];
      if (s.limit > 0) {
        logs.push({
          kind: "error",
          message: `Ordner „${target.path}“ hat 15 GB erreicht – ${s.limit} Foto(s) nicht hochgeladen`,
        });
      }

      // Protokoll + Index im Hintergrund – Ergebnis sofort zeigen
      const toRelease = reserved;
      reserved = [];
      background.current = Promise.all([
        writeLogs(logs),
        upload.accountIds.length ? syncAccounts(upload.accountIds) : Promise.resolve(),
      ])
        .catch(() => undefined)
        .finally(() => releaseNumbers(target.key, toRelease).catch(() => undefined));

      setResult({ upload, plan: finalPlan });
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("done");
      await releaseNumbers(target.key, reserved).catch(() => undefined);
    }
  };

  const close = async () => {
    setClosing(true);
    if (background.current) await background.current;
    onClose(phase === "done");
  };

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
            <div className="muted small ellipsis">nach „{target.path}“</div>
            <h2>
              {phase === "analyse" && "Fotos prüfen"}
              {phase === "review" && `${files.length} Foto${files.length === 1 ? "" : "s"}`}
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

              <button className="btn primary block" disabled={sum.upload === 0} onClick={start}>
                <Icon name="upload" size={19} /> {sum.upload} Foto{sum.upload === 1 ? "" : "s"} hochladen
              </button>
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
                {result.upload.uploaded.length} Foto{result.upload.uploaded.length === 1 ? "" : "s"} hochgeladen
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
