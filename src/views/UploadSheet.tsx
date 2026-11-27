import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon";
import LocalThumb from "../components/LocalThumb";
import PathPicker, { crumbsOf } from "../components/PathPicker";
import Ring from "../components/Ring";
import { ignoreDuplicate, knownMd5, releaseNumbers, reserveNumbers, syncAccounts, writeLogs, type LogInput } from "../lib/db";
import { invalidateFolder, loadFolder } from "../lib/cache";
import { formatBytes } from "../lib/format";
import { byCaptureTime, captureDate } from "../lib/exif";
import { md5OfFile } from "../lib/md5";
import { maxNumber } from "../lib/naming";
import { planUpload, summarize, type PlanEntry, type PlanFile, type PlanInput } from "../lib/plan";
import { executeUpload, retryFailedUploads, type UploadProgress, type UploadResult } from "../lib/upload";
import type { FailedUpload } from "../lib/retryUpload";
import type { Account, Crumb, FolderContent } from "../lib/types";
import { useKeepAwake } from "../lib/wakelock";
import { addMedia, countMedia, isVideo, mediaCount, mediaWord, videosLast, type MediaCount } from "../lib/media";

type Phase = "analyse" | "review" | "upload" | "done";

/** Ein fertig geprüfter Stapel Fotos für einen Zielordner („Weiter“ merkt ihn vor, „Hochladen“ lädt alle). */
interface Batch {
  byId: Map<string, File>;
  target: Crumb;
  input: PlanInput;
  known: Set<string>;
  /** Duplikate in diesem Stapel trotzdem hochladen (Häkchen gilt nur für diese Auswahl) */
  force: boolean;
}

const NO_MEDIA: MediaCount = { photos: 0, videos: 0 };

const NO_SCAN = { list: [] as PlanFile[], time: new Map<string, number>() };
/** Gemerkte Sortierung der Upload-Vorschau: „1“ = neueste zuerst */
const NEWEST_KEY = "drivepool.upload.neuesteZuerst";

const REASON: Record<string, string> = {
  reihenfolge: "Reihenfolge",
  zahlenschutz: "Zahlen-Schutz",
  dazwischen: "lag zwischen den Nummern",
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
  const [files, setFiles] = useState<File[]>(() => videosLast(initialFiles)); // Videos immer nach den Fotos
  // „Weitere Fotos in andere Ordner“: vorgemerkte Stapel, die beim Hochladen mitkommen
  const [more, setMore] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [phase, setPhase] = useState<Phase>("analyse");
  useKeepAwake(phase === "analyse" || phase === "upload"); // Bildschirm bleibt an, solange es läuft
  const [analysed, setAnalysed] = useState(0);
  // Geprüfte Dateien in iOS-Reihenfolge + Aufnahmezeiten; angezeigt wird nach Aufnahmezeit sortiert
  const [scanned, setScanned] = useState<{ list: PlanFile[]; time: Map<string, number> }>(NO_SCAN);
  /** Neueste zuerst statt älteste zuerst (wird gemerkt) */
  const [newestFirst, setNewestFirst] = useState(() => localStorage.getItem(NEWEST_KEY) === "1");
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [orderMode, setOrderMode] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const [conflictMode, setConflictMode] = useState<"skip" | "rename">("skip");
  // Duplikate trotzdem hochladen: Häkchen nur für die aktuelle Auswahl (bei mehreren Ordnern) …
  const [forceDups, setForceDups] = useState(false);
  // … oder Regler für alle Duplikate (ohne „Noch Fotos für andere Ordner“)
  const [forceAll, setForceAll] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [result, setResult] = useState<{ upload: UploadResult; plan: PlanEntry[]; folders: number; media: MediaCount } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Fehlgeschlagene samt Datei – solange das Fenster offen ist, lassen sie sich nochmals hochladen
  const [failedItems, setFailedItems] = useState<FailedUpload[]>([]);
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

  // 1. Prüfsummen berechnen und mit dem Pool vergleichen
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list: PlanFile[] = [];
        const time = new Map<string, number>();
        let i = 0;
        for (const [id, f] of byId) {
          if (cancelled) return;
          const [md5, date] = await Promise.all([md5OfFile(f), captureDate(f)]);
          list.push({ id, name: f.name, size: f.size, md5 });
          if (date) time.set(id, date.getTime());
          setAnalysed(++i);
        }
        const k = await knownMd5(list.map((f) => f.md5));
        if (cancelled) return;
        setScanned({ list, time });
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

  // iOS liefert die Auswahl durcheinander → wie in der Fotos-App nach Aufnahmezeit, Videos weiterhin unten
  const planFiles = useMemo(() => {
    const t = (f: PlanFile) => {
      const ms = scanned.time.get(f.id);
      return ms === undefined ? null : newestFirst ? -ms : ms;
    };
    return byCaptureTime(scanned.list, t, (f) => isVideo(byId.get(f.id)!));
  }, [scanned, newestFirst, byId]);
  /** Sind die Fotos nach Aufnahmezeit sortiert (mind. 2 mit Datum)? */
  const byTime = scanned.time.size > 1;
  const flipOrder = () => {
    const v = !newestFirst;
    setNewestFirst(v);
    if (v) localStorage.setItem(NEWEST_KEY, "1");
    else localStorage.removeItem(NEWEST_KEY);
  };

  const baseInput: PlanInput = useMemo(
    () => ({
      files: planFiles,
      orderMode,
      order,
      startNumber: maxNumber((content?.files ?? []).map((f) => f.name)) + 1,
      existingNames: (content?.files ?? []).map((f) => f.name),
      knownMd5: known,
      // Duplikate nur im gewählten Ordner suchen (gleiches Foto in anderen Ordnern ist erlaubt)
      allowPoolDuplicates: true,
      folderMd5: new Set((content?.files ?? []).map((f) => f.md5).filter((m): m is string => !!m)),
      folderBytes: (content?.files ?? []).reduce((s, f) => s + (f.size ?? 0), 0),
      folderHasSubfolders: (content?.folders.length ?? 0) > 0,
      conflictMode,
      now: new Date(),
    }),
    [planFiles, orderMode, order, content, known, conflictMode],
  );
  /** Gilt „Duplikate trotzdem hochladen“ für die aktuelle Auswahl bzw. einen vorgemerkten Stapel? */
  const forceNow = more ? forceDups : forceAll;
  const forceOf = (b: Batch) => b.force || (!more && forceAll);
  const rawPlan = useMemo(() => planUpload(baseInput), [baseInput]);
  const plan = useMemo(() => (forceNow ? planUpload({ ...baseInput, allowDuplicates: true }) : rawPlan), [baseInput, rawPlan, forceNow]);
  const sum = summarize(plan);
  const dupIds = new Set(rawPlan.filter((e) => e.status === "duplicate").map((e) => e.id));
  const conflictsWithoutRename = useMemo(
    () => summarize(planUpload({ ...baseInput, allowDuplicates: forceNow, conflictMode: "skip" })).conflict,
    [baseInput, forceNow],
  );

  const toggleOrder = (id: string) =>
    setOrder((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));

  /** Fotos/Videos der Einträge, die hochgeladen werden */
  const mediaOf = (ids: string[], from: Map<string, File>) => countMedia(ids.map((id) => from.get(id)).filter((f): f is File => !!f));
  const upMedia = mediaOf(plan.filter((e) => e.status === "upload").map((e) => e.id), byId);
  const snapshot = (): Batch => ({ byId, target, input: baseInput, known, force: forceDups });
  /** Was von einem Stapel wirklich hochgeladen wird (je nach Duplikat-Häkchen/-Regler) */
  const batchInfo = (b: Batch, force: boolean) => {
    const p = planUpload({ ...b.input, allowDuplicates: force });
    const up = p.filter((e) => e.status === "upload").map((e) => e.id);
    return { count: up.length, media: mediaOf(up, b.byId), dups: force ? 0 : summarize(p).duplicate };
  };
  const batchInfos = batches.map((b) => batchInfo(b, forceOf(b)));
  const allMedia = batchInfos.reduce((m, x) => addMedia(m, x.media), upMedia);
  /** Duplikate, die (noch) übersprungen würden – in dieser Auswahl und in den vorgemerkten Stapeln */
  const rawDups = summarize(rawPlan).duplicate;
  const allRawDups = rawDups + batches.reduce((n, b) => n + summarize(planUpload(b.input)).duplicate, 0);

  /** „Weiter“: aktuellen Stapel vormerken und mit neuen Fotos von vorne beginnen (anderer Ordner). */
  const next = (list: File[]) => {
    if (!list.length) return;
    // Auch reine Duplikat-Stapel vormerken – der Regler „Alle Duplikate“ kann sie später noch mitnehmen
    if (sum.upload > 0 || rawDups > 0) setBatches((b) => [...b, snapshot()]);
    setFiles(videosLast(list));
    setForceDups(false); // Häkchen gilt nur für die eben vorgemerkte Auswahl
    setPhase("analyse");
    setAnalysed(0);
    setScanned(NO_SCAN);
    setKnown(new Set());
    setOrderMode(false);
    setOrder([]);
    setShowNames(false);
    setPicking(true); // gleich den Zielordner wählen – die Prüfung läuft solange im Hintergrund
  };

  /** Einen Stapel hochladen; Protokoll + Index laufen danach im Hintergrund weiter. */
  const runBatch = async (b: Batch, force: boolean, accs: Account[], onProgress: (p: UploadProgress) => void) => {
    let reserved: number[] = [];
    const input: PlanInput = { ...b.input, allowDuplicates: force };
    try {
      const numbered = summarize(planUpload(input)).numbered;
      let finalPlan: PlanEntry[];
      if (input.orderMode && numbered > 0) {
        const first = await reserveNumbers(b.target.key, numbered);
        reserved = Array.from({ length: numbered }, (_, i) => first + i);
        finalPlan = planUpload({ ...input, startNumber: first, now: new Date() });
      } else {
        finalPlan = planUpload({ ...input, now: new Date() });
      }
      // Duplikate, die ohne Häkchen/Regler übersprungen worden wären
      const forcedMd5 = force
        ? new Set(planUpload({ ...b.input, allowDuplicates: false }).filter((e) => e.status === "duplicate").map((e) => e.md5))
        : new Set<string>();

      const upload = await executeUpload({ target: b.target, entries: finalPlan, files: b.byId, accounts: accs, onProgress });

      const s = summarize(finalPlan);
      const emailOf = (id: string) => accounts.find((a) => a.id === id)?.email ?? id;
      const logs: LogInput[] = [
        {
          kind: "upload",
          message: `${mediaCount(mediaOf(upload.uploaded.map((u) => u.id), b.byId), "Fotos/Videos")} nach „${b.target.path}“ hochgeladen`,
          details: {
            duplikate: s.duplicate,
            ...(force ? { duplikate_hochgeladen: upload.uploaded.filter((u) => forcedMd5.has(u.md5)).length } : {}),
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
          message: `Ordner „${b.target.path}“ hat 15 GB erreicht – ${s.limit} Datei(en) nicht hochgeladen`,
        });
      }

      const toRelease = reserved;
      reserved = [];
      // Bewusst doppelt hochgeladene Fotos gleich als „bewusst behalten“ markieren (nach dem Abgleich)
      const intended = [...new Set(upload.uploaded.filter((u) => b.known.has(u.md5) || forcedMd5.has(u.md5)).map((u) => u.md5))];
      const bg = Promise.all([
        writeLogs(logs).catch(() => undefined),
        (upload.accountIds.length ? syncAccounts(upload.accountIds) : Promise.resolve([])).then(
          async (res) => {
            await Promise.all(intended.map((m) => ignoreDuplicate(m).catch(() => undefined)));
            // Nummern erst freigeben, wenn die neuen Fotos sicher im Index stehen – sonst bekäme der nächste
            // Upload dieselben Nummern. Scheitert der Abgleich, läuft die Reservierung von selbst ab.
            if (res.every((r) => !r.error && !r.more)) await releaseNumbers(b.target.key, toRelease).catch(() => undefined);
          },
          () => undefined,
        ),
      ]);
      return { upload, plan: finalPlan, bg, media: mediaOf(upload.uploaded.map((u) => u.id), b.byId) };
    } catch (e) {
      await releaseNumbers(b.target.key, reserved).catch(() => undefined);
      throw e;
    }
  };

  const start = async () => {
    setPhase("upload");
    setError(null);
    const all = [
      ...batches.map((b, i) => ({ b, force: forceOf(b), count: batchInfos[i].count })),
      { b: snapshot(), force: forceNow, count: sum.upload },
    ].filter((x) => x.count > 0);
    const total = all.reduce((n, x) => n + x.count, 0);
    const merged: UploadResult = { uploaded: [], failed: [], accountIds: [], createdFolders: [] };
    const plans: PlanEntry[] = [];
    const bgs: Promise<unknown>[] = [];
    let media = NO_MEDIA;
    let before = { done: 0, failed: 0 };
    const retryable: FailedUpload[] = [];
    const errors: string[] = [];
    // Belegten Platz zwischen den Stapeln mitführen – sonst plant jeder Stapel mit dem freien Platz von vorher
    let accs = accounts.map((a) => ({ ...a }));
    try {
      for (const { b, force } of all) {
        let r: Awaited<ReturnType<typeof runBatch>>;
        try {
          r = await runBatch(b, force, accs, (p) => setProgress({ done: before.done + p.done, failed: before.failed + p.failed, total }));
        } catch (e) {
          // Ganzer Stapel gescheitert (z. B. kurz offline): die übrigen Ordner trotzdem versuchen
          const msg = e instanceof Error ? e.message : String(e);
          const p = planUpload({ ...b.input, allowDuplicates: force });
          if (summarize(p).numbered > 0) {
            // Nummern wurden wieder freigegeben – die Reihenfolge muss neu gewählt werden
            errors.push(`„${b.target.path}“: ${msg}`);
          } else {
            plans.push(...p);
            for (const entry of p.filter((x) => x.status === "upload")) {
              merged.failed.push({ entry, error: msg });
              retryable.push({ entry, error: msg, target: b.target, files: b.byId });
            }
          }
          before = { done: merged.uploaded.length, failed: merged.failed.length };
          continue;
        }
        retryable.push(...r.upload.failed.map((f) => ({ ...f, target: b.target, files: b.byId })));
        accs = accs.map((a) => ({
          ...a,
          quota_usage: (a.quota_usage ?? 0) + r.upload.uploaded.filter((u) => u.accountId === a.id).reduce((s, u) => s + u.size, 0),
        }));
        merged.uploaded.push(...r.upload.uploaded);
        merged.failed.push(...r.upload.failed);
        merged.accountIds = [...new Set([...merged.accountIds, ...r.upload.accountIds])];
        merged.createdFolders.push(...r.upload.createdFolders);
        plans.push(...r.plan);
        bgs.push(r.bg);
        media = addMedia(media, r.media);
        before = { done: merged.uploaded.length, failed: merged.failed.length };
      }
      if (errors.length) setError(errors.join(" · "));
      setResult({ upload: merged, plan: plans, folders: all.length, media });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (merged.uploaded.length || merged.failed.length) setResult({ upload: merged, plan: plans, folders: all.length, media });
    } finally {
      background.current = Promise.all(bgs);
      setFailedItems(retryable);
      setTargetsDone(all.map((x) => x.b.target.key));
      setPhase("done");
    }
  };

  /** Nur die fehlgeschlagenen Dateien nochmals hochladen (sie sind noch im Speicher). */
  const retry = async () => {
    if (!result || !failedItems.length) return;
    const items = failedItems;
    setPhase("upload");
    setError(null);
    setProgress({ done: 0, failed: 0, total: items.length });
    try {
      // Erst den Abgleich der ersten Runde abwarten, dann mit dem frischen Ordnerinhalt vergleichen
      if (background.current) await background.current;
      const used = accounts.map((a) => ({
        ...a,
        quota_usage: (a.quota_usage ?? 0) + result.upload.uploaded.filter((u) => u.accountId === a.id).reduce((s, u) => s + u.size, 0),
      }));
      const r = await retryFailedUploads({ items, accounts: used, onProgress: setProgress });
      const ok = [...r.uploaded, ...r.present];
      const fileOf = (u: (typeof ok)[number]) => u.files.get(u.id);
      const emailOf = (id: string) => accounts.find((a) => a.id === id)?.email ?? id;
      const logs: LogInput[] = [];
      for (const path of new Set(items.map((i) => i.target.path))) {
        const here = r.uploaded.filter((u) => u.target.path === path);
        const still = r.failed.filter((f) => f.target.path === path);
        if (!here.length && !still.length) continue;
        logs.push({
          kind: "upload",
          message: `${mediaCount(countMedia(here.map(fileOf).filter((f): f is File => !!f)), "Fotos/Videos")} nach „${path}“ nochmals hochgeladen`,
          details: { fehler: still.map((f) => `${f.entry.originalName}: ${f.error}`), konten: [...new Set(here.map((u) => emailOf(u.accountId)))] },
        });
      }
      for (const c of r.createdFolders) logs.push({ kind: "folder", message: `Ordner „${c.path}“ in ${emailOf(c.accountId)} angelegt` });
      background.current = Promise.all([
        writeLogs(logs).catch(() => undefined),
        r.accountIds.length ? syncAccounts(r.accountIds).catch(() => undefined) : undefined,
      ]);
      setResult({
        ...result,
        upload: {
          uploaded: [...result.upload.uploaded, ...r.uploaded],
          failed: r.failed.map(({ entry, error }) => ({ entry, error })),
          accountIds: [...new Set([...result.upload.accountIds, ...r.accountIds])],
          createdFolders: [...result.upload.createdFolders, ...r.createdFolders],
        },
        media: addMedia(result.media, countMedia(ok.map(fileOf).filter((f): f is File => !!f))),
      });
      setFailedItems(r.failed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
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
              {phase === "analyse" && `${mediaWord(countMedia(files))} prüfen`}
              {phase === "review" && mediaCount(countMedia(files))}
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
                  <span className="faint small">
                    {mediaCount(batchInfos[i].media)}
                    {batchInfos[i].dups > 0 && ` · ${batchInfos[i].dups} doppelt`}
                    {forceOf(b) && summarize(planUpload(b.input)).duplicate > 0 && " · mit Duplikaten"}
                  </span>
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
                    Tippe die Fotos in der gewünschten Reihenfolge an ({sum.numbered}/{sum.upload} gewählt). Nur angetippte
                    werden nummeriert, die anderen behalten ihren Namen.
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

              {byTime && (
                <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                  <span className="faint small">
                    Nach Aufnahmezeit – {newestFirst ? "neueste" : "älteste"} zuerst
                  </span>
                  <button className="btn small ghost" onClick={flipOrder} aria-label="Reihenfolge umdrehen">
                    <Icon name="sortNum" size={15} /> {newestFirst ? "Älteste zuerst" : "Neueste zuerst"}
                  </button>
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
                      <LocalThumb file={byId.get(f.id)!}>
                        {dupIds.has(f.id) && <span className="tag">Duplikat</span>}
                        {entry.status === "conflict" && <span className="tag">Konflikt</span>}
                        {entry.status === "limit" && <span className="tag">15 GB</span>}
                      </LocalThumb>
                      {orderMode && pos >= 0 && <span className="badge">{pos + 1}</span>}
                      <span className="cell-name">{entry.targetName}</span>
                    </button>
                  );
                })}
              </div>


              {conflictsWithoutRename > 0 && (
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
                    Dieser Ordner hat keine Unterordner und erreicht 15 GB. {sum.limit} Datei(en) werden nicht hochgeladen –
                    bitte teile den Ordner selbst auf.
                  </span>
                </div>
              )}

              <div className="stat-chips">
                <span className="stat-chip">
                  <b>{sum.upload}</b> neu · {formatBytes(totalBytes)}
                </span>
                {rawDups > 0 && (
                  <span className="stat-chip">
                    <b>{rawDups}</b> {forceNow ? "Duplikate kommen mit" : "Duplikate"}
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
                  disabled={allMedia.photos + allMedia.videos === 0 || !content || usedKeys.has(target.key)}
                  onClick={start}
                >
                  <Icon name="upload" size={19} />{" "}
                  {batches.length
                    ? `${mediaCount(allMedia)} in ${batches.length + 1} Ordner hochladen`
                    : `${mediaCount(upMedia)} hochladen`}
                </button>
              )}

              <label className="check-row">
                <input type="checkbox" checked={more} onChange={(e) => setMore(e.target.checked)} />
                <span>
                  Noch Fotos für andere Ordner hinzufügen
                  <span className="faint small"> – „Weiter“ merkt diese hier vor, am Schluss wird alles zusammen hochgeladen</span>
                </span>
              </label>

              {more && rawDups > 0 && (
                <label className="check-row">
                  <input type="checkbox" checked={forceDups} onChange={(e) => setForceDups(e.target.checked)} />
                  <span>
                    {rawDups} Duplikat{rawDups === 1 ? "" : "e"} trotzdem hochladen
                    <span className="faint small"> – gilt nur für diese Auswahl, bei der nächsten wieder neu ankreuzen</span>
                  </span>
                </label>
              )}

              {!more && allRawDups > 0 && (
                <label className="switch-row glass">
                  <span>
                    <strong>Alle Duplikate hochladen</strong>
                    <div className="muted small">
                      {forceAll
                        ? `${allRawDups} Duplikat${allRawDups === 1 ? "" : "e"} werden mit hochgeladen`
                        : `${allRawDups} Duplikat${allRawDups === 1 ? "" : "e"} werden übersprungen`}
                    </div>
                  </span>
                  <span className="switch">
                    <input type="checkbox" checked={forceAll} onChange={(e) => setForceAll(e.target.checked)} />
                    <span />
                  </span>
                </label>
              )}
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
                {mediaCount(result.media)} hochgeladen
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
                  {failedItems.length > 0 ? (
                    <button className="btn block" style={{ marginTop: 10 }} onClick={retry} disabled={closing}>
                      <Icon name="upload" size={17} /> {failedItems.length === 1 ? "Fehlgeschlagene" : `${failedItems.length} fehlgeschlagene`}{" "}
                      nochmals hochladen
                    </button>
                  ) : (
                    "Wähle die Fotos einfach nochmals aus – bereits hochgeladene werden übersprungen."
                  )}
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
