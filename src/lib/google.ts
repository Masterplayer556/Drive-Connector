// Direkter Zugriff auf die Google Drive API aus dem Browser mit kurzlebigen Access-Tokens.
import { backoffMs, MAX_RETRIES, shouldRetry } from "./retry";
import { callFunction } from "./supabase";

export const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
export const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  size?: string;
  md5Checksum?: string;
  thumbnailLink?: string;
}

interface TokenInfo {
  token: string;
  expiresAt: number;
}

const tokens = new Map<string, TokenInfo>();
let loading: Promise<{ errors: { email: string; error: string }[] }> | null = null;

/** Lädt Access-Tokens für alle Konten (ruft dabei auch die Besitzer-Prüfung auf). */
export function loadTokens(): Promise<{ errors: { email: string; error: string }[] }> {
  if (!loading) {
    loading = callFunction<{
      tokens: { account_id: string; access_token: string; expires_at: string }[];
      errors: { account_id: string; email: string; error: string }[];
    }>("google-token")
      .then((r) => {
        tokens.clear();
        for (const t of r.tokens) {
          tokens.set(t.account_id, { token: t.access_token, expiresAt: Date.parse(t.expires_at) });
        }
        return { errors: r.errors };
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

export function clearTokens() {
  tokens.clear();
}

async function tokenFor(accountId: string, force = false): Promise<string> {
  const t = tokens.get(accountId);
  if (!force && t && t.expiresAt - Date.now() > 60_000) return t.token;
  await loadTokens();
  const fresh = tokens.get(accountId);
  if (!fresh) throw new Error("Für dieses Konto gibt es keinen Zugriff – bitte unter „Konten“ prüfen");
  return fresh.token;
}

async function googleError(res: Response): Promise<Error> {
  let message = res.statusText;
  try {
    const j = await res.json();
    message = j?.error?.message ?? message;
  } catch {
    /* leer */
  }
  return new Error(`Google (${res.status}): ${message}`);
}

/**
 * fetch mit Bearer-Token; bei 401 wird das Token einmal erneuert. Bremst Google (zu viele Aufrufe) oder hat
 * es einen kurzen Aussetzer, wird nach einer Pause nochmals versucht (siehe retry.ts).
 */
async function authedFetch(accountId: string, url: string, init: RequestInit = {}): Promise<Response> {
  const method = init.method ?? "GET";
  let renewed = false;
  let force = false;
  for (let retries = 0; ; ) {
    const token = await tokenFor(accountId, force);
    force = false;
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 && !renewed) {
      renewed = force = true;
      continue;
    }
    if (retries >= MAX_RETRIES || !(await shouldRetry(res, method))) return res;
    await new Promise((r) => setTimeout(r, backoffMs(retries++, res)));
  }
}

async function driveJson<T>(accountId: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await authedFetch(accountId, url, init);
  if (!res.ok) throw await googleError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const FIELDS = "id,name,mimeType,parents,size,md5Checksum";

/**
 * Vorschau-Links (thumbnailLink) direkt bei Google: ein Aufruf für den ganzen Ordner, Rest einzeln.
 * Die Links gelten nur ein paar Stunden.
 */
export async function thumbnailLinks(accountId: string, folderId: string | null, ids: string[]): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  const wanted = new Set(ids);
  if (folderId) {
    let pageToken: string | undefined;
    do {
      const p = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false`,
        fields: "nextPageToken,files(id,thumbnailLink)",
        pageSize: "1000",
      });
      if (pageToken) p.set("pageToken", pageToken);
      const r = await driveJson<{ nextPageToken?: string; files: { id: string; thumbnailLink?: string }[] }>(accountId, `${DRIVE}/files?${p}`);
      for (const f of r.files) if (f.thumbnailLink) links.set(f.id, f.thumbnailLink);
      pageToken = r.nextPageToken;
    } while (pageToken && [...wanted].some((id) => !links.has(id)));
  }
  const rest = ids.filter((id) => !links.has(id));
  for (let i = 0; i < rest.length; i += 6) {
    await Promise.all(
      rest.slice(i, i + 6).map((id) =>
        driveJson<{ thumbnailLink?: string }>(accountId, `${DRIVE}/files/${encodeURIComponent(id)}?fields=thumbnailLink`)
          .then((m) => void (m.thumbnailLink && links.set(id, m.thumbnailLink)))
          .catch(() => undefined),
      ),
    );
  }
  return links;
}

export function createFolder(accountId: string, name: string, parentId: string): Promise<DriveFile> {
  return driveJson(accountId, `${DRIVE}/files?fields=${FIELDS}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
}

/** Lädt ein Foto direkt vom Handy zu Google hoch (resumable, Ersatzweg multipart). */
export async function uploadPhoto(
  accountId: string,
  parentId: string,
  file: Blob,
  name: string,
  description?: string,
): Promise<DriveFile> {
  const meta: Record<string, unknown> = { name, parents: [parentId] };
  if (description) meta.description = description;
  const type = file.type || "application/octet-stream";

  const init = await authedFetch(accountId, `${UPLOAD}/files?uploadType=resumable&fields=${FIELDS}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": type,
      "X-Upload-Content-Length": String(file.size),
    },
    body: JSON.stringify(meta),
  });
  if (!init.ok) throw await googleError(init);
  const location = init.headers.get("Location");

  if (location) {
    const put = await fetch(location, { method: "PUT", headers: { "Content-Type": type }, body: file });
    if (!put.ok) throw await googleError(put);
    return (await put.json()) as DriveFile;
  }

  // Location-Header nicht lesbar (CORS) → multipart
  const boundary = `drivepool${crypto.randomUUID().replace(/-/g, "")}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
    `--${boundary}\r\nContent-Type: ${type}\r\n\r\n`,
    file,
    `\r\n--${boundary}--`,
  ]);
  return driveJson(accountId, `${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
}

/** In den Papierkorb des Kontos verschieben. */
export function trashItem(accountId: string, id: string): Promise<DriveFile> {
  return driveJson(accountId, `${DRIVE}/files/${encodeURIComponent(id)}?fields=id`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
}

/** Innerhalb desselben Kontos verschieben (ändert nur den Elternordner, nicht den Namen). */
export function moveItem(accountId: string, id: string, newParent: string, oldParent: string): Promise<DriveFile> {
  const p = new URLSearchParams({ addParents: newParent, removeParents: oldParent, fields: "id,parents" });
  return driveJson(accountId, `${DRIVE}/files/${encodeURIComponent(id)}?${p}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

/** Kurzlebiges Zugangs-Token (für das Video-Streaming über den Service Worker). */
export function accessToken(accountId: string): Promise<string> {
  return tokenFor(accountId);
}

/** Ganzes Foto als Blob (für die Grossansicht, falls die Vorschau fehlt). */
export async function downloadBlob(accountId: string, id: string): Promise<Blob> {
  const res = await authedFetch(accountId, `${DRIVE}/files/${encodeURIComponent(id)}?alt=media`);
  if (!res.ok) throw await googleError(res);
  return res.blob();
}

/** Umbenennen (nur auf ausdrücklichen Wunsch, z. B. „Schule“ → „Archiv“). */
export function renameItem(accountId: string, id: string, name: string): Promise<DriveFile> {
  return driveJson(accountId, `${DRIVE}/files/${encodeURIComponent(id)}?fields=id,name`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

// ---------------------------------------------------------------------------
// Etappe 1: Papierkorb, Speicher, Umbenennen mit Beschreibung
// ---------------------------------------------------------------------------
export interface TrashFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  trashedTime?: string;
  parents?: string[];
  explicitlyTrashed?: boolean;
}

/** Vom Nutzer selbst gelöschte Einträge (nicht die Inhalte gelöschter Ordner). */
export async function listTrash(accountId: string): Promise<TrashFile[]> {
  const out: TrashFile[] = [];
  let pageToken: string | undefined;
  do {
    const p = new URLSearchParams({
      q: "trashed = true and 'me' in owners",
      fields: "nextPageToken,files(id,name,mimeType,size,trashedTime,parents,explicitlyTrashed)",
      pageSize: "1000",
    });
    if (pageToken) p.set("pageToken", pageToken);
    const r = await driveJson<{ nextPageToken?: string; files: TrashFile[] }>(accountId, `${DRIVE}/files?${p}`);
    out.push(...r.files.filter((f) => f.explicitlyTrashed !== false));
    pageToken = r.nextPageToken;
  } while (pageToken);
  return out;
}

export function restoreItem(accountId: string, id: string): Promise<DriveFile> {
  return driveJson(accountId, `${DRIVE}/files/${encodeURIComponent(id)}?fields=id`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: false }),
  });
}

export function deleteForever(accountId: string, id: string): Promise<void> {
  return driveJson(accountId, `${DRIVE}/files/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function emptyTrash(accountId: string): Promise<void> {
  return driveJson(accountId, `${DRIVE}/files/trash`, { method: "DELETE" });
}

export interface Quota {
  limit: number | null;
  usage: number;
  trash: number;
}

export async function getQuota(accountId: string): Promise<Quota> {
  const r = await driveJson<{ storageQuota: { limit?: string; usage?: string; usageInDriveTrash?: string } }>(
    accountId,
    `${DRIVE}/about?fields=storageQuota`,
  );
  return {
    limit: r.storageQuota.limit ? Number(r.storageQuota.limit) : null,
    usage: Number(r.storageQuota.usage ?? 0),
    trash: Number(r.storageQuota.usageInDriveTrash ?? 0),
  };
}

/** Name und/oder Beschreibung ändern (Sortieren-Knopf, Regel 12). */
export function updateItem(accountId: string, id: string, body: { name?: string; description?: string }): Promise<DriveFile> {
  return driveJson(accountId, `${DRIVE}/files/${encodeURIComponent(id)}?fields=id,name`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Etappe 2: Teilen-Links (#15)
// ---------------------------------------------------------------------------
/** Link für „jeder mit dem Link kann ansehen“. */
export async function createAnyoneLink(accountId: string, id: string): Promise<{ permissionId: string; url: string }> {
  const p = await driveJson<{ id: string }>(accountId, `${DRIVE}/files/${encodeURIComponent(id)}/permissions?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "anyone", role: "reader", allowFileDiscovery: false }),
  });
  return { permissionId: p.id, url: `https://drive.google.com/file/d/${id}/view?usp=sharing` };
}

export async function deletePermission(accountId: string, id: string, permissionId: string): Promise<void> {
  try {
    await driveJson(accountId, `${DRIVE}/files/${encodeURIComponent(id)}/permissions/${encodeURIComponent(permissionId)}`, {
      method: "DELETE",
    });
  } catch (e) {
    // Schon entfernt (z. B. in Google Drive) → ok
    if (!String(e).includes("404")) throw e;
  }
}

/** Verschieben innerhalb eines Kontos, optional mit neuem Namen (#10). */
export function moveWithin(
  accountId: string,
  id: string,
  newParent: string,
  oldParent: string,
  body: { name?: string; description?: string } = {},
): Promise<DriveFile> {
  const p = new URLSearchParams({ addParents: newParent, removeParents: oldParent, fields: "id,parents" });
  return driveJson(accountId, `${DRIVE}/files/${encodeURIComponent(id)}?${p}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
