// Führt einen geplanten Upload aus: Konto wählen, Zielordner sicherstellen, hochladen.
import { fetchFolderParts } from "./db";
import { PathResolver, pathSegments } from "./folders";
import { uploadPhoto } from "./google";
import type { PlanEntry } from "./plan";
import { accountStates, areaOf, chooseAccount } from "./placement";
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
        result.failed.push({ entry: e, error: "Kein Konto mit genug freiem Speicher" });
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
