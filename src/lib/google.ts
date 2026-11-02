// Direkter Zugriff auf die Google Drive API aus dem Browser mit kurzlebigen Access-Tokens.
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

/** fetch mit Bearer-Token; bei 401 wird das Token einmal erneuert. */
async function authedFetch(accountId: string, url: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await tokenFor(accountId, attempt > 0);
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
    });
    if (res.status !== 401 || attempt > 0) return res;
  }
  throw new Error("unerreichbar");
}

async function driveJson<T>(accountId: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await authedFetch(accountId, url, init);
  if (!res.ok) throw await googleError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const FIELDS = "id,name,mimeType,parents,size,md5Checksum";

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

/** Vorschau-Links aller Fotos in einem physischen Ordner. */
export async function listThumbnails(accountId: string, folderId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let pageToken: string | undefined;
  do {
    const p = new URLSearchParams({
      q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`,
      fields: "nextPageToken,files(id,thumbnailLink)",
      pageSize: "1000",
    });
    if (pageToken) p.set("pageToken", pageToken);
    const r = await driveJson<{ nextPageToken?: string; files: DriveFile[] }>(accountId, `${DRIVE}/files?${p}`);
    for (const f of r.files) if (f.thumbnailLink) out.set(f.id, f.thumbnailLink);
    pageToken = r.nextPageToken;
  } while (pageToken);
  return out;
}

/** Ganzes Foto als Blob (für die Grossansicht, falls die Vorschau fehlt). */
export async function downloadBlob(accountId: string, id: string): Promise<Blob> {
  const res = await authedFetch(accountId, `${DRIVE}/files/${encodeURIComponent(id)}?alt=media`);
  if (!res.ok) throw await googleError(res);
  return res.blob();
}

/** Vorschau-Link auf eine andere Grösse umstellen (=s220 → =s1600). */
export function sizedThumb(link: string, size: number): string {
  return /=s\d+(-[a-z0-9-]+)?$/.test(link) ? link.replace(/=s\d+(-[a-z0-9-]+)?$/, `=s${size}`) : `${link}=s${size}`;
}

/** Umbenennen (nur auf ausdrücklichen Wunsch, z. B. „Schule“ → „Archiv“). */
export function renameItem(accountId: string, id: string, name: string): Promise<DriveFile> {
  return driveJson(accountId, `${DRIVE}/files/${encodeURIComponent(id)}?fields=id,name`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}
