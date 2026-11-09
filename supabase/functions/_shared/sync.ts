// Gemeinsame Sync-Logik (App-Aufruf „sync“ und nächtlicher Job „nightly“).
// Erster Lauf pro Konto: komplette Liste. Danach nur Änderungen (Drive Changes API).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { DRIVE, FOLDER_MIME, getAccessToken, gfetch } from "./google.ts";
import { HttpError } from "./http.ts";

const FILE_FIELDS =
  "id,name,mimeType,parents,size,md5Checksum,imageMediaMetadata(time),createdTime,modifiedTime,description,trashed,ownedByMe";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  size?: string;
  md5Checksum?: string;
  imageMediaMetadata?: { time?: string };
  createdTime?: string;
  modifiedTime?: string;
  description?: string;
  trashed?: boolean;
  ownedByMe?: boolean;
}

export interface Account {
  id: string;
  owner_id: string;
  email: string;
  changes_page_token: string | null;
}

/** EXIF-Zeit "2023:05:01 14:22:11" → "2023-05-01T14:22:11Z" */
function exifToIso(value?: string): string | null {
  if (!value) return null;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function toRow(f: DriveFile, acc: Account) {
  return {
    account_id: acc.id,
    owner_id: acc.owner_id,
    drive_id: f.id,
    name: f.name,
    is_folder: f.mimeType === FOLDER_MIME,
    mime_type: f.mimeType,
    parent_drive_id: f.parents?.[0] ?? null,
    size: f.size ? Number(f.size) : null,
    md5: f.md5Checksum ?? null,
    taken_at: exifToIso(f.imageMediaMetadata?.time),
    created_time: f.createdTime ?? null,
    modified_time: f.modifiedTime ?? null,
    description: f.description ?? null,
  };
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function fullSync(admin: SupabaseClient, acc: Account, token: string) {
  const start = await gfetch<{ startPageToken: string }>(token, `${DRIVE}/changes/startPageToken`);
  const root = await gfetch<{ id: string }>(token, `${DRIVE}/files/root?fields=id`);

  const rows: ReturnType<typeof toRow>[] = [];
  let pageToken: string | undefined;
  do {
    const p = new URLSearchParams({
      q: "'me' in owners and trashed = false",
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      pageSize: "1000",
      spaces: "drive",
    });
    if (pageToken) p.set("pageToken", pageToken);
    const r = await gfetch<{ nextPageToken?: string; files: DriveFile[] }>(token, `${DRIVE}/files?${p}`);
    for (const f of r.files) rows.push(toRow(f, acc));
    pageToken = r.nextPageToken;
  } while (pageToken);

  // Lesezeichen zuerst entfernen: bricht der Lauf zwischen Leeren und Füllen ab, liest der nächste wieder
  // alles ein – statt mit einem halben Index und dem alten Lesezeichen nur noch Änderungen zu holen.
  if (acc.changes_page_token) {
    const reset = await admin.from("accounts").update({ changes_page_token: null }).eq("id", acc.id);
    if (reset.error) throw reset.error;
  }
  const del = await admin.from("items").delete().eq("account_id", acc.id);
  if (del.error) throw del.error;
  for (const part of chunks(rows, 1000)) {
    const ins = await admin.from("items").insert(part);
    if (ins.error) throw ins.error;
  }
  const upd = await admin
    .from("accounts")
    .update({ changes_page_token: start.startPageToken, root_folder_id: root.id })
    .eq("id", acc.id);
  if (upd.error) throw upd.error;
  return rows.length;
}

type Log = (msg: string) => void;

export interface SyncOptions {
  /** Zeitpunkt (ms), ab dem keine neue Änderungsseite mehr geholt wird – der Rest folgt im nächsten Lauf. */
  deadline?: number;
  log?: Log;
}

/**
 * Holt die Änderungen seitenweise und speichert jede Seite sofort – samt Lesezeichen
 * (changes_page_token). So geht bei einem Abbruch nichts verloren und der nächste Lauf
 * macht genau dort weiter, auch wenn sich zehntausende Änderungen angesammelt haben.
 */
async function incrementalSync(
  admin: SupabaseClient,
  acc: Account,
  token: string,
  opts: SyncOptions,
): Promise<{ changed: number; more: boolean } | "reset"> {
  let cursor = acc.changes_page_token!;
  let changed = 0;
  let pages = 0;

  for (;;) {
    const p = new URLSearchParams({
      pageToken: cursor,
      fields: `nextPageToken,newStartPageToken,changes(removed,fileId,file(${FILE_FIELDS}))`,
      pageSize: "1000",
      spaces: "drive",
      includeRemoved: "true",
    });
    let r: {
      nextPageToken?: string;
      newStartPageToken?: string;
      changes: { removed?: boolean; fileId: string; file?: DriveFile }[];
    };
    try {
      r = await gfetch(token, `${DRIVE}/changes?${p}`);
    } catch (e) {
      // Ungültiges/abgelaufenes Seiten-Token → komplett neu einlesen
      if (e instanceof HttpError && (e.status === 400 || e.status === 404 || e.status === 410)) return "reset";
      throw e;
    }

    // Innerhalb einer Seite gilt der letzte Stand einer Datei
    const pending = new Map<string, ReturnType<typeof toRow> | null>();
    for (const c of r.changes) {
      const f = c.file;
      if (c.removed || !f || f.trashed || f.ownedByMe === false) pending.set(c.fileId, null);
      else pending.set(c.fileId, toRow(f, acc));
    }
    const deletes = [...pending].filter(([, row]) => row === null).map(([id]) => id);
    const upserts = [...pending.values()].filter((row): row is ReturnType<typeof toRow> => row !== null);
    for (const part of chunks(deletes, 200)) {
      const d = await admin.from("items").delete().eq("account_id", acc.id).in("drive_id", part);
      if (d.error) throw d.error;
    }
    if (upserts.length) {
      const u = await admin.from("items").upsert(upserts, { onConflict: "account_id,drive_id" });
      if (u.error) throw u.error;
    }

    const next = r.nextPageToken ?? r.newStartPageToken;
    if (next && next !== cursor) {
      const upd = await admin.from("accounts").update({ changes_page_token: next }).eq("id", acc.id);
      if (upd.error) throw upd.error;
      cursor = next;
    }
    changed += pending.size;
    pages++;

    if (!r.nextPageToken) break;
    if (opts.deadline && Date.now() > opts.deadline) {
      opts.log?.(`${pages} Seiten, ${changed} Änderungen – Rest folgt im nächsten Lauf`);
      return { changed, more: true };
    }
  }
  opts.log?.(`${pages} Seiten, ${changed} Änderungen`);
  return { changed, more: false };
}

export async function syncAccount(admin: SupabaseClient, acc: Account, full: boolean, opts: SyncOptions = {}) {
  const { token } = await getAccessToken(admin, acc.id);

  let changed: number;
  let more = false;
  let mode: "full" | "changes" = full || !acc.changes_page_token ? "full" : "changes";
  if (mode === "full") {
    changed = await fullSync(admin, acc, token);
  } else {
    const r = await incrementalSync(admin, acc, token, opts);
    if (r === "reset") {
      mode = "full";
      changed = await fullSync(admin, acc, token);
    } else {
      ({ changed, more } = r);
    }
  }

  if (mode === "full" || changed > 0) {
    const t = Date.now();
    const rp = await admin.rpc("recompute_paths", { p_account: acc.id });
    if (rp.error) throw rp.error;
    opts.log?.(`Pfade neu berechnet (${Date.now() - t} ms)`);
  }

  const about = await gfetch<{ storageQuota: { limit?: string; usage?: string } }>(
    token,
    `${DRIVE}/about?fields=storageQuota`,
  );
  const upd = await admin
    .from("accounts")
    .update({
      quota_limit: about.storageQuota.limit ? Number(about.storageQuota.limit) : null,
      quota_usage: about.storageQuota.usage ? Number(about.storageQuota.usage) : null,
      quota_updated_at: new Date().toISOString(),
      // Erst wenn alle Änderungen eingelesen sind, gilt das Konto als abgeglichen
      ...(more ? {} : { last_sync_at: new Date().toISOString() }),
      status: "active",
      status_message: null,
    })
    .eq("id", acc.id);
  if (upd.error) throw upd.error;

  return { account_id: acc.id, email: acc.email, mode, changed, more };
}
