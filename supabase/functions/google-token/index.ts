// Liefert kurzlebige Google-Access-Tokens (ca. 1 Stunde) für alle aktiven Konten.
// Der erste Aufruf nach dem Login macht den Nutzer zum Besitzer der App.
import { adminClient, requireOwner } from "../_shared/auth.ts";
import { getAccessToken } from "../_shared/google.ts";
import { errorResponse, json, preflight } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const admin = adminClient();
    const user = await requireOwner(req, admin);
    const { data: accounts, error } = await admin
      .from("accounts")
      .select("id, email")
      .eq("owner_id", user.id)
      .eq("status", "active");
    if (error) throw error;

    const tokens: { account_id: string; access_token: string; expires_at: string }[] = [];
    const errors: { account_id: string; email: string; error: string }[] = [];
    await Promise.all(
      (accounts ?? []).map(async (a) => {
        try {
          const t = await getAccessToken(admin, a.id);
          tokens.push({ account_id: a.id, access_token: t.token, expires_at: t.expiresAt });
        } catch (e) {
          errors.push({ account_id: a.id, email: a.email, error: e instanceof Error ? e.message : String(e) });
        }
      }),
    );
    return json({ tokens, errors });
  } catch (e) {
    return errorResponse(e);
  }
});
