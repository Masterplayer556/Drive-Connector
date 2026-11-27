// Führt einen geplanten Upload aus: Konto wählen, Zielordner sicherstellen, hochladen.
import { invalidateFolder, loadFolder } from "./cache";
import { fetchFolderParts, syncAccounts } from "./db";
import { PathResolver, pathSegments } from "./folders";
import { uploadPhoto } from "./google";
import type { PlanEntry } from "./plan";
import { accountStates, areaOf, chooseAccount, noAccountMessage } from "./placement";
import { groupByTarget, planRetry, type FailedUpload } from "./retryUpload";
import type { Account, Crumb } from "./types";
import { keepAwake } from "./wakelock";

export interface UploadProgress {
  done: number;
  failed: number;
  total: number;
}

export interface UploadResult {
  uploaded: (PlanEntry & { accountId: string })[];
  failed: { entry: PlanEntry; error: string }[];
  accountIds: string[];
  createdFolders: { accountId: string; path: string }[];
}

const PARALLEL = 3;

export async function executeUpload(opts: {
  target: Crumb;
  entries: PlanEntry[];
  files: Map<string, File>;
  accounts: Account[];
  onProgress: (p: UploadProgress) => void;
}): Promise<UploadResult> {
  const release = await keepAwake();
  const result: UploadResult = { uploaded: [], failed: [], accountIds: [], createdFolders: [] };
  try {
    const todo = opts.entries.filter((e) => e.status === "upload");
    const states = accountStates(opts.accounts);
    const parts = await fetchFolderParts(opts.target.path);
    const folderAccounts = [...new Set(parts.map((p) => p.account_id))];
    const area = areaOf(opts.target.path);

    // 1. Konto für jedes Foto festlegen
    const assigned = new Map<string, string>();
    for (const e of todo) {
      const id = chooseAccount(states, { folderAccounts, area, size: e.size });
      if (!id) {
        result.failed.push({ entry: e, error: noAccountMessage(area) });
        continue;
      }
      const s = states.find((a) => a.id === id)!;
      s.free -= e.size;
      if (!folderAccounts.includes(id)) folderAccounts.push(id);
      assigned.set(e.id, id);
    }

    // 2. Zielordner in jedem benötigten Konto sicherstellen
    const resolver = new PathResolver(opts.accounts);
    const parentByAccount = new Map<string, string>();
    for (const p of parts) if (!parentByAccount.has(p.account_id)) parentByAccount.set(p.account_id, p.drive_id);
    for (const accountId of new Set(assigned.values())) {
      if (parentByAccount.has(accountId)) continue;
      try {
        parentByAccount.set(accountId, await resolver.ensure(accountId, pathSegments(opts.target.path)));
      } catch (e) {
        for (const entry of todo) {
          if (assigned.get(entry.id) === accountId) {
            assigned.delete(entry.id);
            result.failed.push({ entry, error: e instanceof Error ? e.message : String(e) });
          }
        }
      }
    }
    result.createdFolders = resolver.created;

    // 3. Hochladen (einige parallel)
    const queue = todo.filter((e) => assigned.has(e.id));
    const total = todo.length;
    let done = 0;
    const report = () => opts.onProgress({ done, failed: result.failed.length, total });
    report();

    const worker = async () => {
      for (let e = queue.shift(); e; e = queue.shift()) {
        const accountId = assigned.get(e.id)!;
        try {
          const file = opts.files.get(e.id);
          if (!file) throw new Error("Datei nicht mehr verfügbar");
          await uploadPhoto(
            accountId,
            parentByAccount.get(accountId)!,
            file,
            e.targetName,
            e.renamed ? `Originalname: ${e.originalName}` : undefined,
          );
          result.uploaded.push({ ...e, accountId });
          done++;
        } catch (err) {
          result.failed.push({ entry: e, error: err instanceof Error ? err.message : String(err) });
        }
        report();
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));

    result.accountIds = [...new Set([...result.uploaded.map((u) => u.accountId), ...resolver.created.map((c) => c.accountId)])];
    return result;
  } finally {
    release();
  }
}

export interface RetryResult {
  /** Jetzt hochgeladen */
  uploaded: (PlanEntry & { accountId: string; target: Crumb; files: Map<string, File> })[];
  /** Kam beim ersten Mal doch an (liegt schon im Ordner) */
  present: (PlanEntry & { target: Crumb; files: Map<string, File> })[];
  /** Weiterhin fehlgeschlagen – lässt sich erneut versuchen */
  failed: FailedUpload[];
  accountIds: string[];
  createdFolders: { accountId: string; path: string }[];
}

/**
 * Lädt fehlgeschlagene Dateien nochmals hoch. Vorher wird der Index aller Konten abgeglichen und jeder
 * Zielordner frisch geladen: Dateien, die trotz Fehlermeldung angekommen sind, werden nicht doppelt hochgeladen.
 */
export async function retryFailedUploads(opts: {
  items: FailedUpload[];
  accounts: Account[];
  onProgress: (p: UploadProgress) => void;
}): Promise<RetryResult> {
  const out: RetryResult = { uploaded: [], present: [], failed: [], accountIds: [], createdFolders: [] };
  const total = opts.items.length;
  let done = 0;
  const report = (p?: UploadProgress) => opts.onProgress({ done: done + (p?.done ?? 0), failed: out.failed.length + (p?.failed ?? 0), total });
  report();
  // Abgleich scheitert (z. B. kurz offline)? Dann mit dem bekannten Stand weiter – der Ordnervergleich unten
  // fängt dann zwar weniger ab, aber nichts wird überschrieben.
  await syncAccounts().catch(() => undefined);
  let accs = opts.accounts.map((a) => ({ ...a }));
  for (const g of groupByTarget(opts.items)) {
    try {
      invalidateFolder(g.target.key);
      const content = await loadFolder(g.target.key).catch(() => null);
      const plan = planRetry(g.entries, content?.files ?? []);
      for (const e of plan.present) out.present.push({ ...e, target: g.target, files: g.files });
      for (const b of plan.blocked) out.failed.push({ ...b, target: g.target, files: g.files });
      done += plan.present.length;
      report();
      if (!plan.retry.length) continue;
      const r = await executeUpload({ target: g.target, entries: plan.retry, files: g.files, accounts: accs, onProgress: report });
      done += r.uploaded.length;
      for (const u of r.uploaded) out.uploaded.push({ ...u, target: g.target, files: g.files });
      for (const f of r.failed) out.failed.push({ ...f, target: g.target, files: g.files });
      out.accountIds = [...new Set([...out.accountIds, ...r.accountIds])];
      out.createdFolders.push(...r.createdFolders);
      accs = accs.map((a) => ({
        ...a,
        quota_usage: (a.quota_usage ?? 0) + r.uploaded.filter((u) => u.accountId === a.id).reduce((s, u) => s + u.size, 0),
      }));
    } catch (e) {
      // Ganzer Ordner gescheitert (z. B. offline): alle noch offenen Dateien bleiben zum nächsten Versuch
      const error = e instanceof Error ? e.message : String(e);
      const handled = (id: string) =>
        out.failed.some((f) => f.files === g.files && f.entry.id === id) || out.present.some((p) => p.files === g.files && p.id === id);
      for (const entry of g.entries) if (!handled(entry.id)) out.failed.push({ entry, error, target: g.target, files: g.files });
    }
    report();
  }
  return out;
}
