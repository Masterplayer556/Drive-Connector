// Lesen aus dem Index (Postgres) und Schreiben ins Protokoll.
import type { BigFolder, PoolStats } from "./insights";
import { childKey, naturalCompare } from "./naming";
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
  error?: string;
}

export async function syncAccounts(accountIds?: string[], full = false): Promise<SyncResult[]> {
  const r = await callFunction<{ results: SyncResult[] }>("sync", { account_ids: accountIds, full });
  return r.results;
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
}

export async function fetchDuplicates(): Promise<DuplicateGroup[]> {
  const { data, error } = await supabase.rpc("find_duplicates");
  if (error) throw new Error(error.message);
  return (data ?? []) as DuplicateGroup[];
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
