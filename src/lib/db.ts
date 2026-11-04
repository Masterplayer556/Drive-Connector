// Lesen aus dem Index (Postgres) und Schreiben ins Protokoll.
import type { Plan, Step, Unit } from "./rebalance";
import type { BigFolder, PoolStats } from "./insights";
import { childKey, naturalCompare } from "./naming";
import { deleteForever } from "./google";
import { callFunction, supabase } from "./supabase";
import type { Account, FolderContent, Item, LogEntry, LogicalFolder, LogKind, Role } from "./types";

const ITEM_COLS =
  "account_id,drive_id,name,is_folder,mime_type,parent_drive_id,size,md5,taken_at,description,path,parent_key";
const PAGE = 1000;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

async function fetchAll<T>(page: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

/** Für ilike: Platzhalter-Zeichen im Pfad wörtlich nehmen. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function fetchAccounts(): Promise<Account[]> {
  const { data, error } = await supabase
    .from("accounts")
    .select("id,email,role,root_folder_id,quota_limit,quota_usage,status,status_message,last_sync_at,created_at")
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as Account[];
}

export async function setAccountRole(id: string, role: Role): Promise<void> {
  const { error } = await supabase.from("accounts").update({ role }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Inhalt eines logischen Ordners aus allen Konten, zusammengeführt. */
export async function fetchFolder(key: string): Promise<FolderContent> {
  const rows = await fetchAll<Item>((from, to) =>
    supabase
      .from("items")
      .select(ITEM_COLS)
      .eq("parent_key", key)
      .order("account_id")
      .order("drive_id")
      .range(from, to),
  );

  const folders = new Map<string, LogicalFolder>();
  const files: Item[] = [];
  for (const r of rows) {
    if (r.is_folder) {
      const k = childKey(key, r.name);
      const f = folders.get(k);
      if (f) f.parts.push(r);
      else folders.set(k, { key: k, name: r.name, path: r.path ?? r.name, parts: [r] });
    } else {
      files.push(r);
    }
  }
  files.sort((a, b) => naturalCompare(a.name, b.name) || a.account_id.localeCompare(b.account_id));
  return {
    folders: [...folders.values()].sort((a, b) => naturalCompare(a.name, b.name)),
    files,
  };
}

/** Alle physischen Ordner (in allen Konten) mit diesem Pfad. */
export async function fetchFolderParts(path: string): Promise<Item[]> {
  if (!path) return [];
  const { data, error } = await supabase
    .from("items")
    .select(ITEM_COLS)
    .eq("is_folder", true)
    .ilike("path", escapeLike(path));
  if (error) throw new Error(error.message);
  return (data ?? []) as Item[];
}

export async function findFolderInAccount(accountId: string, path: string): Promise<Item | null> {
  const { data, error } = await supabase
    .from("items")
    .select(ITEM_COLS)
    .eq("account_id", accountId)
    .eq("is_folder", true)
    .ilike("path", escapeLike(path))
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as Item | undefined) ?? null;
}

/** Welche dieser Prüfsummen gibt es schon im Pool? */
export async function knownMd5(md5s: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const unique = [...new Set(md5s)];
  for (let i = 0; i < unique.length; i += 150) {
    const { data, error } = await supabase.from("items").select("md5").in("md5", unique.slice(i, i + 150));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) if (r.md5) out.add(r.md5);
  }
  return out;
}

export async function rootLevelItems(): Promise<Item[]> {
  return fetchAll<Item>((from, to) =>
    supabase.from("items").select(ITEM_COLS).eq("parent_key", "").order("name").range(from, to),
  );
}

export async function reserveNumbers(folderKey: string, count: number): Promise<number> {
  const { data, error } = await supabase.rpc("reserve_numbers", { p_folder_key: folderKey, p_count: count });
  if (error) throw new Error(error.message);
  return Number(data);
}

export async function releaseNumbers(folderKey: string, numbers: number[]): Promise<void> {
  if (!numbers.length) return;
  const { error } = await supabase.rpc("release_numbers", { p_folder_key: folderKey, p_numbers: numbers });
  if (error) throw new Error(error.message);
}

export interface LogInput {
  kind: LogKind;
  message: string;
  details?: unknown;
}

export async function writeLogs(entries: LogInput[]): Promise<void> {
  if (!entries.length) return;
  for (let i = 0; i < entries.length; i += 500) {
    const { error } = await supabase.from("activity_log").insert(entries.slice(i, i + 500));
    if (error) console.warn("Protokoll konnte nicht geschrieben werden", error.message);
  }
}

export function writeLog(kind: LogKind, message: string, details?: unknown): Promise<void> {
  return writeLogs([{ kind, message, details }]);
}

export async function fetchLog(kind: LogKind | null, limit = 300): Promise<LogEntry[]> {
  let q = supabase
    .from("activity_log")
    .select("id,created_at,kind,message,details")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (kind) q = q.eq("kind", kind);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as LogEntry[];
}

export interface SyncResult {
  account_id: string;
  email: string;
  mode?: "full" | "changes";
  changed?: number;
  /** Es warten noch weitere Änderungen – der Server liest sie im nächsten Aufruf ein. */
  more?: boolean;
  error?: string;
}

export async function syncAccounts(accountIds?: string[], full = false): Promise<SyncResult[]> {
  let r = await callFunction<{ results: SyncResult[] }>("sync", { account_ids: accountIds, full });
  const results = new Map(r.results.map((x) => [x.account_id, x]));
  // Viele angesammelte Änderungen: weiterlesen, bis alles da ist (höchstens 10 Runden)
  for (let round = 0; round < 10; round++) {
    const open = [...results.values()].filter((x) => x.more && !x.error).map((x) => x.account_id);
    if (!open.length) break;
    r = await callFunction<{ results: SyncResult[] }>("sync", { account_ids: open });
    for (const x of r.results) {
      const prev = results.get(x.account_id);
      results.set(x.account_id, { ...x, changed: (prev?.changed ?? 0) + (x.changed ?? 0) });
    }
  }
  window.dispatchEvent(new Event("drivepool-synced")); // KI-SUCHE: neue Fotos gleich lernen
  return [...results.values()];
}

// ---------------------------------------------------------------------------
// Etappe 1: Kennzahlen, grosse Ordner, Duplikate, Einstellungen, Unterbaum
// ---------------------------------------------------------------------------

export async function fetchStats(): Promise<PoolStats> {
  const { data, error } = await supabase.rpc("pool_stats");
  if (error) throw new Error(error.message);
  return data as PoolStats;
}

export async function fetchBigFolders(minBytes: number): Promise<BigFolder[]> {
  const { data, error } = await supabase.rpc("big_folders", { p_min: minBytes });
  if (error) throw new Error(error.message);
  return (data ?? []) as BigFolder[];
}

export interface DuplicateGroup {
  md5: string;
  total: number;
  items: Item[];
  /** Bewusst behalten (gehört thematisch in mehrere Ordner) */
  ignored: boolean;
}

export async function fetchDuplicates(): Promise<DuplicateGroup[]> {
  const { data, error } = await supabase.rpc("find_duplicates");
  if (error) throw new Error(error.message);
  return (data ?? []) as DuplicateGroup[];
}

/** Duplikat bewusst behalten – erscheint nicht mehr, solange die Kopien in denselben Ordnern liegen. */
export async function ignoreDuplicate(md5: string): Promise<void> {
  const { error } = await supabase.rpc("ignore_duplicate", { p_md5: md5 });
  if (error) throw new Error(error.message);
}

export async function unignoreDuplicate(md5: string): Promise<void> {
  const { error } = await supabase.rpc("unignore_duplicate", { p_md5: md5 });
  if (error) throw new Error(error.message);
}

export interface Settings {
  trash_auto_days: number | null;
}

export async function fetchSettings(): Promise<Settings> {
  const { data, error } = await supabase.from("settings").select("trash_auto_days").maybeSingle();
  if (error) throw new Error(error.message);
  return { trash_auto_days: data?.trash_auto_days ?? null };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const { data: s } = await supabase.auth.getSession();
  const owner_id = s.session?.user.id;
  if (!owner_id) throw new Error("Nicht angemeldet");
  const { error } = await supabase
    .from("settings")
    .upsert({ owner_id, ...patch, updated_at: new Date().toISOString() }, { onConflict: "owner_id" });
  if (error) throw new Error(error.message);
}

/** Alle Fotos in einem Ordner und seinen Unterordnern (für ZIP-Download). */
export async function fetchSubtreeFiles(path: string): Promise<Item[]> {
  const rows = await fetchAll<Item>((from, to) =>
    supabase
      .from("items")
      .select(ITEM_COLS)
      .eq("is_folder", false)
      .ilike("path", `${escapeLike(path)}/%`)
      .order("path")
      .range(from, to),
  );
  return rows;
}

/** Wie viele Fotos stecken in einem Ordner (inkl. Unterordner)? Für die Lösch-Rückfrage. */
export async function countSubtreeFiles(path: string): Promise<number | null> {
  const { count, error } = await supabase
    .from("items")
    .select("drive_id", { count: "exact", head: true })
    .eq("is_folder", false)
    .ilike("path", `${escapeLike(path)}/%`);
  return error ? null : count;
}

// ---------------------------------------------------------------------------
// Etappe 2: Suche, Favoriten, Teilen-Links, Statistik
// ---------------------------------------------------------------------------
export async function searchItems(query: string, limit = 200): Promise<Item[]> {
  const { data, error } = await supabase.rpc("search_items", { p_query: query, p_limit: limit });
  if (error) throw new Error(error.message);
  return (data ?? []) as Item[];
}

export async function fetchFavoriteKeys(): Promise<Set<string>> {
  const { data, error } = await supabase.from("favorites").select("account_id,drive_id");
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((f) => `${f.account_id}|${f.drive_id}`));
}

export async function fetchFavoriteItems(): Promise<Item[]> {
  const { data, error } = await supabase.rpc("favorite_items");
  if (error) throw new Error(error.message);
  return (data ?? []) as Item[];
}

export async function setFavorite(item: Item, on: boolean): Promise<void> {
  if (on) {
    const { error } = await supabase
      .from("favorites")
      .upsert({ account_id: item.account_id, drive_id: item.drive_id }, { onConflict: "owner_id,account_id,drive_id" });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("favorites").delete().eq("account_id", item.account_id).eq("drive_id", item.drive_id);
    if (error) throw new Error(error.message);
  }
}

export interface Share {
  id: string;
  account_id: string;
  drive_id: string;
  name: string;
  permission_id: string;
  url: string;
  expires_at: string | null;
  created_at: string;
}

export async function fetchShares(): Promise<Share[]> {
  const { data, error } = await supabase.from("shares").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Share[];
}

export async function insertShare(s: Omit<Share, "id" | "created_at">): Promise<void> {
  const { error } = await supabase.from("shares").insert(s);
  if (error) throw new Error(error.message);
}

export async function deleteShareRow(id: string): Promise<void> {
  const { error } = await supabase.from("shares").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export interface MonthStat {
  month: string;
  files: number;
  /** Davon Videos (fehlt, wenn die Datenbank-Funktion noch alt ist) */
  videos?: number;
  bytes: number;
}
export interface KindStat {
  kind: "foto" | "video" | "andere";
  files: number;
  bytes: number;
}
export interface AreaStat {
  area: string;
  files: number;
  bytes: number;
}
export interface FolderStat {
  parent_key: string;
  path: string;
  files: number;
  bytes: number;
}
export interface Snapshot {
  day: string;
  usage: number;
  quota: number;
  files: number;
}

export async function fetchStatistics(): Promise<{ months: MonthStat[]; areas: AreaStat[]; folders: FolderStat[]; snapshots: Snapshot[]; kinds: KindStat[] }> {
  // Fotos/Videos getrennt (neuere Funktionen) – fehlen sie, gilt die alte Statistik ohne Aufteilung
  const [m0, k] = await Promise.all([supabase.rpc("upload_months_media", { p_months: 12 }), supabase.rpc("media_kinds")]);
  const [m, a, f, s] = await Promise.all([
    m0.error ? supabase.rpc("upload_months", { p_months: 12 }) : Promise.resolve(m0),
    supabase.rpc("area_usage"),
    supabase.rpc("top_folders", { p_limit: 8 }),
    supabase.from("usage_snapshots").select("day,usage,quota,files").order("day").limit(400),
  ]);
  for (const r of [m, a, f, s]) if (r.error) throw new Error(r.error.message);
  const num = <T extends object>(rows: T[]) =>
    rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v])) as T);
  return {
    months: num((m.data ?? []) as MonthStat[]),
    areas: num((a.data ?? []) as AreaStat[]),
    folders: num((f.data ?? []) as FolderStat[]),
    snapshots: num((s.data ?? []) as Snapshot[]),
    kinds: k.error ? [] : num((k.data ?? []) as KindStat[]),
  };
}

// ---------------------------------------------------------------------------
// Etappe 3: Rebalancing (Regal-Ansicht, Sperren, Gruppenregel, Pläne)
// ---------------------------------------------------------------------------
export async function fetchUnits(): Promise<Unit[]> {
  const { data, error } = await supabase.rpc("rebalance_units");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Unit[]).map((u) => ({ ...u, files: Number(u.files), bytes: Number(u.bytes) }));
}

export async function fetchLocks(): Promise<Set<string>> {
  const { data, error } = await supabase.from("folder_locks").select("path_key");
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((l) => l.path_key as string));
}

export async function setLock(pathKey: string, on: boolean): Promise<void> {
  const { error } = on
    ? await supabase.from("folder_locks").upsert({ path_key: pathKey }, { onConflict: "owner_id,path_key" })
    : await supabase.from("folder_locks").delete().eq("path_key", pathKey);
  if (error) throw new Error(error.message);
}

export async function fetchGroupFolder(): Promise<string | null> {
  const { data, error } = await supabase.from("settings").select("group_folder").maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.group_folder as string | null) ?? null;
}

export async function saveGroupFolder(key: string | null): Promise<void> {
  const { data: s } = await supabase.auth.getSession();
  const owner_id = s.session?.user.id;
  if (!owner_id) throw new Error("Nicht angemeldet");
  const { error } = await supabase
    .from("settings")
    .upsert({ owner_id, group_folder: key, updated_at: new Date().toISOString() }, { onConflict: "owner_id" });
  if (error) throw new Error(error.message);
}

export interface PlanRow {
  id: string;
  signature: string;
  steps: Step[];
  bytes: number;
  status: "queued" | "running" | "done" | "rejected" | "failed";
  total: number;
  done: number;
  failed: number;
  message: string | null;
  created_at: string;
  finished_at: string | null;
  purged_at: string | null;
}

/**
 * Nach einem Rebalancing die Originale (liegen im Papierkorb der Quellkonten) sofort endgültig löschen,
 * damit der Platz gleich frei wird. Nur Dateien, deren Kopie geprüft wurde (Status „done“).
 */
export async function purgePlanOriginals(planId: string, onProgress?: (done: number, total: number) => void): Promise<{ ok: number; failed: number }> {
  const rows: { src_account: string; drive_id: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("rebalance_tasks")
      .select("src_account, drive_id")
      .eq("plan_id", planId)
      .eq("status", "done")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 1000) break;
  }
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += 6) {
    await Promise.all(
      rows.slice(i, i + 6).map((r) =>
        deleteForever(r.src_account, r.drive_id).then(
          () => ok++,
          (e) => (String(e).includes("404") ? ok++ : failed++), // schon weg → zählt als erledigt
        ),
      ),
    );
    onProgress?.(Math.min(i + 6, rows.length), rows.length);
  }
  if (!failed) await supabase.rpc("mark_plan_purged", { p_plan: planId });
  await writeLog(failed ? "error" : "delete", `Rebalancing: ${ok} Originale endgültig gelöscht${failed ? `, ${failed} fehlgeschlagen` : ""}`, { plan: planId });
  return { ok, failed };
}

export async function fetchPlans(limit = 20): Promise<PlanRow[]> {
  const { data, error } = await supabase.from("rebalance_plans").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as PlanRow[];
}

export async function savePlan(plan: Plan, status: "queued" | "rejected"): Promise<void> {
  const { error } = await supabase
    .from("rebalance_plans")
    .insert({ signature: plan.signature, steps: plan.steps, bytes: plan.bytes, status });
  if (error) throw new Error(error.message);
}

export interface RebalanceProgress {
  plans: { plan_id: string; total: number; done: number; failed: number; status: string }[];
  more: boolean;
}

/** Führt offene Pläne aus und ruft so lange erneut auf, bis alles erledigt ist. */
// Nur ein Lauf pro App: ein zweiter Aufruf (z. B. Regal neu geöffnet) hängt sich an den laufenden an
let running: Promise<RebalanceProgress> | null = null;
const listeners = new Set<(p: RebalanceProgress) => void>();

export function runRebalance(onProgress?: (p: RebalanceProgress) => void, signal?: { stop: boolean }): Promise<RebalanceProgress> {
  if (onProgress) listeners.add(onProgress);
  if (!running) {
    running = rebalanceLoop((p) => listeners.forEach((l) => l(p)), signal).finally(() => {
      running = null;
      listeners.clear();
    });
  }
  return running;
}

async function rebalanceLoop(onProgress: (p: RebalanceProgress) => void, signal?: { stop: boolean }): Promise<RebalanceProgress> {
  let errors = 0;
  for (;;) {
    const started = Date.now();
    let r: RebalanceProgress;
    try {
      r = await callFunction<RebalanceProgress>("rebalance");
      errors = 0;
    } catch (e) {
      // Verbindung kurz weg (z. B. Bildschirm gesperrt) → der Server arbeitet trotzdem weiter; nochmals versuchen
      if (++errors > 3 || signal?.stop) {
        throw new Error("Verbindung unterbrochen – das Rebalancing läuft auf dem Server bzw. nachts automatisch weiter.", { cause: e });
      }
      await new Promise((res) => setTimeout(res, 4000 * errors));
      continue;
    }
    onProgress(r);
    if (!r.more || signal?.stop) return r;
    // Arbeitet gerade ein anderer Lauf, kommt die Antwort sofort → kurz warten statt den Server zu fluten
    if (Date.now() - started < 5000) await new Promise((res) => setTimeout(res, 4000));
  }
}
