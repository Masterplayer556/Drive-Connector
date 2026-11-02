// Aktualisiert den Datei-Index in Postgres aus Google Drive.
// Erster Lauf pro Konto: komplette Liste. Danach nur Änderungen (Drive Changes API).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { adminClient, requireOwner } from "../_shared/auth.ts";
import { DRIVE, FOLDER_MIME, getAccessToken, gfetch } from "../_shared/google.ts";
import { errorResponse, HttpError, json, preflight } from "../_shared/http.ts";

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

interface Account {
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

async function incrementalSync(admin: SupabaseClient, acc: Account, token: string): Promise<number | "reset"> {
  const pending = new Map<string, ReturnType<typeof toRow> | null>();
  let pageToken: string | undefined = acc.changes_page_token ?? undefined;
  let newStart: string | undefined;

  while (pageToken) {
    const p = new URLSearchParams({
      pageToken,
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
    for (const c of r.changes) {
      const f = c.file;
      if (c.removed || !f || f.trashed || f.ownedByMe === false) pending.set(c.fileId, null);
      else pending.set(c.fileId, toRow(f, acc));
    }
    pageToken = r.nextPageToken;
    if (r.newStartPageToken) newStart = r.newStartPageToken;
  }

  const deletes = [...pending].filter(([, row]) => row === null).map(([id]) => id);
  const upserts = [...pending.values()].filter((row): row is ReturnType<typeof toRow> => row !== null);

  for (const part of chunks(deletes, 200)) {
    const d = await admin.from("items").delete().eq("account_id", acc.id).in("drive_id", part);
    if (d.error) throw d.error;
  }
  for (const part of chunks(upserts, 1000)) {
    const u = await admin.from("items").upsert(part, { onConflict: "account_id,drive_id" });
    if (u.error) throw u.error;
  }
  if (newStart) {
    const upd = await admin.from("accounts").update({ changes_page_token: newStart }).eq("id", acc.id);
    if (upd.error) throw upd.error;
  }
  return pending.size;
}

async function syncAccount(admin: SupabaseClient, acc: Account, full: boolean) {
  const { token } = await getAccessToken(admin, acc.id);

  let changed: number;
  let mode: "full" | "changes" = full || !acc.changes_page_token ? "full" : "changes";
  if (mode === "full") {
    changed = await fullSync(admin, acc, token);
  } else {
    const r = await incrementalSync(admin, acc, token);
    if (r === "reset") {
      mode = "full";
      changed = await fullSync(admin, acc, token);
    } else {
      changed = r;
    }
  }

  if (mode === "full" || changed > 0) {
    const rp = await admin.rpc("recompute_paths", { p_account: acc.id });
    if (rp.error) throw rp.error;
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
      last_sync_at: new Date().toISOString(),
      status: "active",
      status_message: null,
    })
    .eq("id", acc.id);
  if (upd.error) throw upd.error;

  return { account_id: acc.id, email: acc.email, mode, changed };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const admin = adminClient();
    const user = await requireOwner(req, admin);
    const body = await req.json().catch(() => ({}));
    const ids: string[] | undefined = Array.isArray(body.account_ids) ? body.account_ids : undefined;
    const full = body.full === true;

    let query = admin
      .from("accounts")
      .select("id, owner_id, email, changes_page_token")
      .eq("owner_id", user.id)
      .eq("status", "active");
    if (ids?.length) query = query.in("id", ids);
    const { data: accounts, error } = await query;
    if (error) throw error;

    const results = await Promise.all(
      (accounts ?? []).map((acc) =>
        syncAccount(admin, acc as Account, full).catch((e) => ({
          account_id: acc.id,
          email: acc.email,
          error: e instanceof Error ? e.message : String(e),
        }))
      ),
    );

    const failed = results.filter((r) => "error" in r);
    if (failed.length) {
      await admin.from("activity_log").insert({
        owner_id: user.id,
        kind: "error",
        message: `Synchronisierung fehlgeschlagen: ${failed.map((f) => f.email).join(", ")}`,
        details: { results: failed },
      });
    }
    return json({ results });
  } catch (e) {
    return errorResponse(e);
  }
});
