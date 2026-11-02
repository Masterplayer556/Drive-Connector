// Vorschaubilder für die App – im Paket (bis 40 pro Aufruf).
// Der direkte Google-Link funktioniert im iPhone-Browser nicht (fehlende Google-Cookies),
// deshalb holt diese Funktion die Bilder mit dem Konto-Token und gibt sie gesammelt zurück.
import { adminClient, requireOwner } from "../_shared/auth.ts";
import { DRIVE, getAccessToken, gfetch } from "../_shared/google.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, errorResponse, HttpError, json, preflight } from "../_shared/http.ts";

const MAX_IDS = 40;
const ID_RE = /^[\w-]{5,200}$/;
const accountOwners = new Map<string, string>();

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function sized(link: string, size: number): string {
  return /=s\d+(-[a-z0-9-]+)?$/i.test(link) ? link.replace(/=s\d+(-[a-z0-9-]+)?$/i, `=s${size}`) : `${link}=s${size}`;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** Alter Weg (ein Bild pro Aufruf, GET) – für noch nicht aktualisierte App-Versionen. */
async function legacySingle(req: Request, admin: SupabaseClient, userId: string): Promise<Response> {
  const url = new URL(req.url);
  const accountId = url.searchParams.get("account_id") ?? "";
  const fileId = url.searchParams.get("file_id") ?? "";
  const size = Math.min(Math.max(Number(url.searchParams.get("size")) || 400, 100), 2000);
  if (!accountId || !ID_RE.test(fileId)) throw new HttpError(400, "account_id und file_id nötig");
  const { data: acc } = await admin.from("accounts").select("owner_id").eq("id", accountId).maybeSingle();
  if (!acc || acc.owner_id !== userId) throw new HttpError(404, "Konto nicht gefunden");
  const { token } = await getAccessToken(admin, accountId);
  const meta = await gfetch<{ thumbnailLink?: string }>(token, `${DRIVE}/files/${fileId}?fields=thumbnailLink`);
  if (!meta.thumbnailLink) throw new HttpError(404, "Keine Vorschau vorhanden");
  const res = await fetch(sized(meta.thumbnailLink, size), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new HttpError(502, `Vorschau nicht ladbar (${res.status})`);
  return new Response(res.body, {
    headers: {
      ...corsHeaders,
      "Content-Type": res.headers.get("Content-Type") ?? "image/jpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const admin = adminClient();
    const user = await requireOwner(req, admin);
    if (req.method === "GET") return await legacySingle(req, admin, user.id);
    const body = await req.json().catch(() => ({}));

    const accountId = String(body.account_id ?? "");
    const folderId = typeof body.folder_id === "string" && ID_RE.test(body.folder_id) ? body.folder_id : null;
    const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === "string" && ID_RE.test(x)) : [];
    const size = Math.min(Math.max(Number(body.size) || 320, 100), 2000);
    if (!accountId || ids.length === 0) throw new HttpError(400, "account_id und ids nötig");
    if (ids.length > MAX_IDS) throw new HttpError(400, `Höchstens ${MAX_IDS} Bilder pro Aufruf`);

    if (accountOwners.get(accountId) !== user.id) {
      const { data: acc } = await admin.from("accounts").select("owner_id").eq("id", accountId).maybeSingle();
      if (!acc || acc.owner_id !== user.id) throw new HttpError(404, "Konto nicht gefunden");
      accountOwners.set(accountId, acc.owner_id);
    }

    const { token } = await getAccessToken(admin, accountId);

    // Vorschau-Links: ein Aufruf für den ganzen Ordner, Rest einzeln
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
        const r = await gfetch<{ nextPageToken?: string; files: { id: string; thumbnailLink?: string }[] }>(
          token,
          `${DRIVE}/files?${p}`,
        );
        for (const f of r.files) if (wanted.has(f.id) && f.thumbnailLink) links.set(f.id, f.thumbnailLink);
        pageToken = r.nextPageToken;
      } while (pageToken && links.size < wanted.size);
    }
    const rest = ids.filter((id) => !links.has(id));
    await mapLimit(rest, 10, async (id) => {
      try {
        const m = await gfetch<{ thumbnailLink?: string }>(token, `${DRIVE}/files/${id}?fields=thumbnailLink`);
        if (m.thumbnailLink) links.set(id, m.thumbnailLink);
      } catch {
        /* fehlt → missing */
      }
    });

    // Bilder parallel holen
    const thumbs: Record<string, string> = {};
    const missing: string[] = [];
    await mapLimit(ids, 12, async (id) => {
      const link = links.get(id);
      if (!link) return void missing.push(id);
      try {
        const res = await fetch(sized(link, size), { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return void missing.push(id);
        const type = res.headers.get("Content-Type") ?? "image/jpeg";
        thumbs[id] = `data:${type};base64,${toBase64(new Uint8Array(await res.arrayBuffer()))}`;
      } catch {
        missing.push(id);
      }
    });

    return json({ thumbs, missing });
  } catch (e) {
    return errorResponse(e);
  }
});
