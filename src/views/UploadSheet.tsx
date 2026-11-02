import { useEffect, useMemo, useState } from "react";
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
    let finalPlan = plan;
    let reserved: number[] = [];
    try {
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
      await writeLogs(logs);
      if (upload.accountIds.length) await syncAccounts(upload.accountIds);
      setResult({ upload, plan: finalPlan });
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("done");
    } finally {
      // Nach dem Sync sind hochgeladene Nummern im Index – Reservierungen freigeben
      await releaseNumbers(target.key, reserved).catch(() => undefined);
    }
  };

  const totalBytes = plan.filter((e) => e.status === "upload").reduce((s, e) => s + e.size, 0);

  return (
    <div className="sheet">
      <div className="sheet-head">
        <strong>Hochladen nach „{target.path}“</strong>
        {phase !== "upload" && (
          <button className="btn ghost" onClick={() => onClose(phase === "done")}>
            ✕
          </button>
        )}
      </div>

      {error && <div className="banner error">{error}</div>}

      {phase === "analyse" && !error && (
        <div className="stack pad">
          <p>
            Prüfe Fotos … {analysed}/{files.length}
          </p>
          <div className="bar">
            <div className="bar-fill" style={{ width: `${(analysed / files.length) * 100}%` }} />
          </div>
        </div>
      )}

      {phase === "review" && (
        <div className="stack pad">
          <label className="switch">
            <input
              type="checkbox"
              checked={orderMode}
              onChange={(e) => {
                setOrderMode(e.target.checked);
                setOrder([]);
              }}
            />
            <span>Reihenfolge festlegen</span>
          </label>
          {orderMode && (
            <>
              <p className="muted small">
                Tippe die Fotos in der gewünschten Reihenfolge an. Nicht angetippte folgen danach. Es wird ab{" "}
                <strong>{baseInput.startNumber}</strong> gezählt.
              </p>
              <div className="row">
                <button className="btn small" onClick={() => setOrder(planFiles.map((f) => f.id))}>
                  Auswahlreihenfolge übernehmen
                </button>
                <button className="btn small ghost" onClick={() => setOrder([])}>
                  Zurücksetzen
                </button>
              </div>
            </>
          )}

          <div className="grid">
            {planFiles.map((f) => {
              const entry = plan.find((e) => e.id === f.id)!;
              const pos = order.indexOf(f.id);
              return (
                <button
                  key={f.id}
                  className={`cell ${entry.status !== "upload" ? "dimmed" : ""}`}
                  onClick={() => orderMode && entry.status === "upload" && toggleOrder(f.id)}
                >
                  <img className="thumb" src={previews.get(f.id)} alt={f.name} />
                  {orderMode && pos >= 0 && <span className="badge">{pos + 1}</span>}
                  {entry.status === "duplicate" && <span className="tag">Duplikat</span>}
                  {entry.status === "conflict" && <span className="tag">Konflikt</span>}
                  {entry.status === "limit" && <span className="tag">15 GB</span>}
                  <span className="cell-name">{entry.targetName}</span>
                </button>
              );
            })}
          </div>

          {conflictsWithoutRename > 0 && !orderMode && (
            <div className="card stack">
              <p>
                <strong>{conflictsWithoutRename}</strong> Foto(s) haben einen Namen, den es in diesem Ordner schon gibt.
              </p>
              <label className="radio">
                <input type="radio" checked={conflictMode === "skip"} onChange={() => setConflictMode("skip")} />
                Überspringen
              </label>
              <label className="radio">
                <input type="radio" checked={conflictMode === "rename"} onChange={() => setConflictMode("rename")} />
                Mit „Foto_Datum“-Namen hochladen
              </label>
            </div>
          )}

          {sum.limit > 0 && (
            <div className="banner warn">
              Dieser Ordner hat keine Unterordner und erreicht 15 GB. {sum.limit} Foto(s) werden nicht hochgeladen –
              bitte teile den Ordner selbst auf.
            </div>
          )}

          <div className="card small">
            <div>
              <strong>{sum.upload}</strong> werden hochgeladen ({formatBytes(totalBytes)})
            </div>
            {sum.duplicate > 0 && <div>{sum.duplicate} Duplikat(e) werden übersprungen</div>}
            {sum.renamed > 0 && <div>{sum.renamed} werden umbenannt (Zahlen-Schutz / Konflikt)</div>}
            {sum.numbered > 0 && <div>{sum.numbered} werden nummeriert</div>}
            {sum.conflict > 0 && <div>{sum.conflict} Konflikt(e) werden übersprungen</div>}
            <button className="link" onClick={() => setShowNames((s) => !s)}>
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
          </div>

          <button className="btn primary" disabled={sum.upload === 0} onClick={start}>
            Hochladen ({sum.upload})
          </button>
        </div>
      )}

      {phase === "upload" && (
        <div className="stack pad">
          <p>
            Lade hoch … {progress?.done ?? 0}/{progress?.total ?? sum.upload}
            {progress && progress.failed > 0 && <> · {progress.failed} Fehler</>}
          </p>
          <div className="bar">
            <div
              className="bar-fill"
              style={{ width: `${progress && progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
          <p className="muted small">Bitte die App offen lassen – der Bildschirm bleibt an.</p>
        </div>
      )}

      {phase === "done" && result && (
        <div className="stack pad">
          <p>
            <strong>{result.upload.uploaded.length} hochgeladen</strong>
            {summarize(result.plan).duplicate > 0 && <> · {summarize(result.plan).duplicate} Duplikate übersprungen</>}
            {result.upload.uploaded.filter((u) => u.renamed && u.renamed !== "reihenfolge").length > 0 && (
              <> · {result.upload.uploaded.filter((u) => u.renamed && u.renamed !== "reihenfolge").length} umbenannt</>
            )}
            {summarize(result.plan).conflict > 0 && <> · {summarize(result.plan).conflict} Konflikte übersprungen</>}
            {summarize(result.plan).limit > 0 && <> · {summarize(result.plan).limit} blockiert (15 GB)</>}
          </p>
          {result.upload.failed.length > 0 && (
            <div className="banner error">
              <strong>{result.upload.failed.length} fehlgeschlagen:</strong>
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
          <button className="btn primary" onClick={() => onClose(true)}>
            Schliessen
          </button>
        </div>
      )}
      {phase === "done" && !result && (
        <div className="stack pad">
          <button className="btn primary" onClick={() => onClose(true)}>
            Schliessen
          </button>
        </div>
      )}
    </div>
  );
}
