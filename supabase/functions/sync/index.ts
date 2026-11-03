// Aktualisiert den Datei-Index in Postgres aus Google Drive (Aufruf aus der App).
import { adminClient, requireOwner } from "../_shared/auth.ts";
import { errorResponse, json, preflight } from "../_shared/http.ts";
import { type Account, syncAccount } from "../_shared/sync.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const started = Date.now();
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
        syncAccount(admin, acc as Account, full, { deadline: started + 90_000 }).catch((e) => ({
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
