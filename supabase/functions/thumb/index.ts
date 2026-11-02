// Ersatzweg für Vorschaubilder, falls der direkte Google-Link im Browser nicht lädt.
import { adminClient, requireOwner } from "../_shared/auth.ts";
import { DRIVE, getAccessToken, gfetch } from "../_shared/google.ts";
import { corsHeaders, errorResponse, HttpError, preflight } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const admin = adminClient();
    const user = await requireOwner(req, admin);
    const url = new URL(req.url);
    const accountId = url.searchParams.get("account_id");
    const fileId = url.searchParams.get("file_id");
    const size = Math.min(Math.max(Number(url.searchParams.get("size") ?? 400) || 400, 100), 2000);
    if (!accountId || !fileId) throw new HttpError(400, "account_id und file_id nötig");

    const { data: acc } = await admin
      .from("accounts")
      .select("id")
      .eq("id", accountId)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!acc) throw new HttpError(404, "Konto nicht gefunden");

    const { token } = await getAccessToken(admin, accountId);
    const meta = await gfetch<{ thumbnailLink?: string }>(
      token,
      `${DRIVE}/files/${encodeURIComponent(fileId)}?fields=thumbnailLink`,
    );
    if (!meta.thumbnailLink) throw new HttpError(404, "Keine Vorschau vorhanden");

    const link = meta.thumbnailLink.replace(/=s\d+$/, `=s${size}`);
    const res = await fetch(link, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new HttpError(502, `Vorschau nicht ladbar (${res.status})`);
    return new Response(res.body, {
      headers: {
        ...corsHeaders,
        "Content-Type": res.headers.get("Content-Type") ?? "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
});
