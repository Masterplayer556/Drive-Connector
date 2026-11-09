// Teilen-Menü (iOS-Kurzbefehl): eine Datei mit persönlichem Schlüssel in Drive Pool hochladen.
// Aufruf: POST …/share-upload?folder=Eingang  · Header x-drive-pool-key: <Schlüssel>, x-file-name: <Name>
// Körper: die Datei selbst. Das Konto wird nach denselben Regeln gewählt wie in der App:
// Privat/… nur in Privat-Konten, Claude/… nur in Claude-Konten, alles andere nur in offenen Konten.
import { adminClient } from "../_shared/auth.ts";
import { DRIVE, FOLDER_MIME, getAccessToken, gfetch } from "../_shared/google.ts";
import { errorResponse, HttpError, json, preflight } from "../_shared/http.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const MAX_BYTES = 150 * 1024 * 1024; // grössere Dateien bitte in der App hochladen
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Bereich aus dem obersten Ordner: "privat", "claude", "schule" (Archiv) oder null (ohne Bereich). */
function zoneOf(path: string): string | null {
  const top = path.split("/")[0]?.toLowerCase();
  if (top === "privat") return "privat";
  if (top === "claude") return "claude";
  if (top === "archiv" || top === "schule") return "schule";
  return null;
}

/** Ordnerpfad säubern: keine leeren Teile, kein „..“, keine verbotenen Zeichen. */
function cleanFolder(raw: string | null): string {
  const parts = (raw ?? "Eingang")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length || parts.some((p) => p === "." || p === ".." || /[\\:*?"<>|]/.test(p))) {
    throw new HttpError(400, "Ungültiger Ordner");
  }
  return parts.join("/");
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/heic": "heic",
  "image/png": "png",
  "image/gif": "gif",
  "video/quicktime": "mov",
  "video/mp4": "mp4",
  "application/pdf": "pdf",
};

/** Kurzbefehle schicken den Namen meist kodiert (%20 …) – ein einzelnes „%“ im Namen darf aber nichts abbrechen. */
function decodeName(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function fileName(raw: string | null, mime: string): string {
  let name = raw ? decodeName(raw).trim().replace(/[\\/]/g, "-") : "";
  if (!name || name === ".") {
    const stamp = new Date().toISOString().slice(0, 19).replace("T", " ").replace(/:/g, "-");
    name = `Geteilt ${stamp}`;
  }
  if (!/\.[A-Za-z0-9]{1,8}$/.test(name) && EXT[mime]) name += `.${EXT[mime]}`;
  return name;
}

/** Zielordner im Konto sicherstellen (fehlende Ordner anlegen und in den Index eintragen). */
async function ensureFolder(admin: SupabaseClient, acc: { id: string; root_folder_id: string }, ownerId: string, token: string, path: string) {
  const segs = path.split("/");
  let parent = acc.root_folder_id;
  for (let i = 1; i <= segs.length; i++) {
    const prefix = segs.slice(0, i).join("/");
    const { data } = await admin
      .from("items")
      .select("drive_id")
      .eq("account_id", acc.id)
      .eq("is_folder", true)
      .ilike("path", escapeLike(prefix))
      .limit(1);
    let id: string | undefined = data?.[0]?.drive_id;
    if (!id) {
      const f = await gfetch<{ id: string }>(token, `${DRIVE}/files?fields=id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: segs[i - 1], mimeType: FOLDER_MIME, parents: [parent] }),
      });
      id = f.id;
      await admin.from("items").insert({
        account_id: acc.id,
        owner_id: ownerId,
        drive_id: id,
        name: segs[i - 1],
        is_folder: true,
        mime_type: FOLDER_MIME,
        parent_drive_id: parent,
        path: prefix,
        parent_key: segs.slice(0, i - 1).join("/").toLowerCase(),
      });
    }
    parent = id;
  }
  return parent;
}

/** Freien Namen im Zielordner finden: „Foto.jpg“ → „Foto (2).jpg“ … */
async function freeName(admin: SupabaseClient, ownerId: string, folder: string, name: string): Promise<string> {
  const { data } = await admin
    .from("items")
    .select("name")
    .eq("owner_id", ownerId)
    .eq("parent_key", folder.toLowerCase())
    .eq("is_folder", false);
  const taken = new Set((data ?? []).map((r) => (r.name as string).toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  const m = /^(.*?)(\.[^.]*)?$/.exec(name)!;
  for (let n = 2; ; n++) {
    const candidate = `${m[1]} (${n})${m[2] ?? ""}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    if (req.method !== "POST") throw new HttpError(405, "Nur POST");
    const admin = adminClient();

    // 1. Schlüssel prüfen (gespeichert ist nur der Hash) – und dass er dem Besitzer der App gehört
    const key = req.headers.get("x-drive-pool-key")?.trim();
    if (!key) throw new HttpError(401, "Schlüssel fehlt");
    const { data: tok } = await admin.from("share_tokens").select("id, owner_id").eq("token_hash", await sha256Hex(key)).maybeSingle();
    if (!tok) throw new HttpError(401, "Schlüssel ungültig – in der App unter Mehr → Teilen-Menü neu erstellen");
    const { data: owner } = await admin.from("app_owner").select("user_id").maybeSingle();
    if (!owner || owner.user_id !== tok.owner_id) throw new HttpError(403, "Nicht erlaubt");
    const ownerId = tok.owner_id as string;

    // 2. Datei lesen
    const url = new URL(req.url);
    const folder = cleanFolder(url.searchParams.get("folder"));
    const mime = (req.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim();
    const tooBig = () => new HttpError(413, "Zu gross fürs Teilen-Menü (max. 150 MB) – bitte in der App hochladen");
    // Grösse schon vor dem Einlesen prüfen, wenn sie angegeben ist (spart Arbeitsspeicher)
    if (Number(req.headers.get("content-length")) > MAX_BYTES) throw tooBig();
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.length) throw new HttpError(400, "Keine Datei erhalten");
    if (bytes.length > MAX_BYTES) throw tooBig();

    // 3. Konto wählen – im Gebiet des Ordners, bevorzugt wo der Ordner schon liegt, sonst mit dem meisten Platz
    const zone = zoneOf(folder);
    const { data: accs } = await admin
      .from("accounts")
      .select("id, email, role, root_folder_id, quota_limit, quota_usage")
      .eq("owner_id", ownerId)
      .eq("status", "active");
    const free = (a: { quota_limit: number | null; quota_usage: number | null }) =>
      a.quota_limit === null ? Number.POSITIVE_INFINITY : Number(a.quota_limit) - Number(a.quota_usage ?? 0);
    const ok = (accs ?? []).filter(
      (a) => a.root_folder_id && (zone ? a.role === zone : a.role !== "privat" && a.role !== "claude") && free(a) >= bytes.length,
    );
    if (!ok.length) throw new HttpError(409, zone ? `Kein ${zone === "schule" ? "Archiv" : zone === "privat" ? "Privat" : "Claude"}-Konto mit genug Platz` : "Kein Konto mit genug Platz");
    const { data: has } = await admin
      .from("items")
      .select("account_id")
      .eq("owner_id", ownerId)
      .eq("is_folder", true)
      .ilike("path", escapeLike(folder));
    const inFolder = new Set((has ?? []).map((r) => r.account_id as string));
    const pool = ok.some((a) => inFolder.has(a.id)) ? ok.filter((a) => inFolder.has(a.id)) : ok;
    const acc = pool.reduce((best, a) => (free(a) > free(best) ? a : best));

    // 4. Hochladen (fortsetzbarer Upload, eine Anfrage)
    const { token } = await getAccessToken(admin, acc.id);
    const parent = await ensureFolder(admin, acc as { id: string; root_folder_id: string }, ownerId, token, folder);
    const name = await freeName(admin, ownerId, folder, fileName(req.headers.get("x-file-name"), mime));
    const init = await fetch(`${UPLOAD}/files?uploadType=resumable&fields=id,name,md5Checksum,size,mimeType,createdTime`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mime,
        "X-Upload-Content-Length": String(bytes.length),
      },
      body: JSON.stringify({ name, parents: [parent] }),
    });
    const location = init.headers.get("Location");
    if (!init.ok || !location) throw new HttpError(502, `Google ${init.status}: Upload konnte nicht starten`);
    const up = await fetch(location, {
      method: "PUT",
      headers: { "Content-Type": mime },
      body: bytes,
      signal: AbortSignal.timeout(120_000),
    });
    if (!up.ok) throw new HttpError(502, `Google ${up.status}: Upload fehlgeschlagen`);
    const f = (await up.json()) as { id: string; name: string; md5Checksum?: string; size?: string; mimeType?: string; createdTime?: string };

    // 5. Index und Protokoll
    await admin.from("items").upsert({
      account_id: acc.id,
      owner_id: ownerId,
      drive_id: f.id,
      name: f.name,
      is_folder: false,
      mime_type: f.mimeType ?? mime,
      parent_drive_id: parent,
      size: f.size ? Number(f.size) : bytes.length,
      md5: f.md5Checksum ?? null,
      created_time: f.createdTime ?? new Date().toISOString(),
      path: `${folder}/${f.name}`,
      parent_key: folder.toLowerCase(),
    });
    await admin.from("share_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", tok.id);
    await admin.from("activity_log").insert({
      owner_id: ownerId,
      kind: "upload",
      message: `„${f.name}“ über das Teilen-Menü nach „${folder}“ hochgeladen`,
      details: { konto: acc.email },
    });
    return json({ ok: true, message: `„${f.name}“ → ${folder}`, name: f.name, folder, account: acc.email });
  } catch (e) {
    return errorResponse(e);
  }
});
