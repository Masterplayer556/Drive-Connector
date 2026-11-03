// Nächtlicher Job (#13), gestartet von pg_cron in der Datenbank:
// alle Konten abgleichen, Papierkorb nach Einstellung leeren, abgelaufene Teilen-Links entfernen,
// Speicherverlauf für die Statistik festhalten. Zugang nur mit dem Geheimnis aus der Datenbank.
import { adminClient } from "../_shared/auth.ts";
import { DRIVE, getAccessToken, gfetch } from "../_shared/google.ts";
import { errorResponse, HttpError, json } from "../_shared/http.ts";
import { runRebalance } from "../_shared/rebalance.ts";
import { type Account, syncAccount } from "../_shared/sync.ts";

const DEADLINE_MS = 110_000; // Supabase beendet Funktionen nach 150 s

Deno.serve(async (req) => {
  const started = Date.now();
  const step = (name: string) => console.log(`[nightly] ${name} nach ${Date.now() - started} ms`);
  const timeLeft = () => DEADLINE_MS - (Date.now() - started);
  try {
    const admin = adminClient();
    const secret = req.headers.get("x-cron-secret") ?? "";
    const { data: allowed } = await admin.rpc("check_cron_secret", { p_secret: secret });
    if (allowed !== true) throw new HttpError(403, "Nicht erlaubt");
    step("Zugang geprüft");

    const { data: owner } = await admin.from("app_owner").select("user_id").maybeSingle();
    if (!owner) return json({ skipped: "kein Besitzer" });
    const ownerId: string = owner.user_id;

    const { data: accounts } = await admin
      .from("accounts")
      .select("id, owner_id, email, changes_page_token")
      .eq("owner_id", ownerId)
      .eq("status", "active");

    // 1. Abgleich
    let changed = 0;
    const failed: string[] = [];
    const unfinished: string[] = [];
    for (const acc of (accounts ?? []) as Account[]) {
      if (timeLeft() < 20_000) {
        failed.push(`${acc.email}: übersprungen (Zeitlimit)`);
        continue;
      }
      try {
        const r = await syncAccount(admin, acc, false, {
          deadline: started + DEADLINE_MS - 25_000,
          log: (m) => step(`${acc.email}: ${m}`),
        });
        changed += r.changed;
        if (r.more) unfinished.push(acc.email);
        step(`Abgleich ${acc.email}: ${r.mode}, ${r.changed} Änderungen`);
      } catch (e) {
        failed.push(`${acc.email}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 2. Papierkorb nach Einstellung leeren
    step("Abgleich fertig");
    let purged = 0;
    const { data: settings } = await admin.from("settings").select("trash_auto_days").eq("owner_id", ownerId).maybeSingle();
    if (settings?.trash_auto_days) {
      const cutoff = new Date(Date.now() - settings.trash_auto_days * 86_400_000).toISOString();
      for (const acc of (accounts ?? []) as Account[]) {
        try {
          const { token } = await getAccessToken(admin, acc.id);
          const p = new URLSearchParams({
            q: `trashed = true and 'me' in owners and trashedTime < '${cutoff}'`,
            fields: "files(id,explicitlyTrashed)",
            pageSize: "500",
          });
          const r = await gfetch<{ files: { id: string; explicitlyTrashed?: boolean }[] }>(token, `${DRIVE}/files?${p}`);
          for (const f of r.files.filter((x) => x.explicitlyTrashed !== false)) {
            if (timeLeft() < 10_000) break;
            const res = await fetch(`${DRIVE}/files/${f.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
            if (res.ok) purged++;
          }
        } catch (e) {
          failed.push(`Papierkorb ${acc.email}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    step("Papierkorb fertig");
    // 3. Abgelaufene Teilen-Links entfernen
    let expired = 0;
    const { data: shares } = await admin
      .from("shares")
      .select("id, account_id, drive_id, permission_id")
      .eq("owner_id", ownerId)
      .lt("expires_at", new Date().toISOString());
    for (const s of shares ?? []) {
      try {
        const { token } = await getAccessToken(admin, s.account_id);
        const res = await fetch(`${DRIVE}/files/${s.drive_id}/permissions/${s.permission_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok || res.status === 404) {
          await admin.from("shares").delete().eq("id", s.id);
          expired++;
        }
      } catch {
        /* nächste Nacht erneut */
      }
    }

    step("Links fertig");
    // 3b. Offene Rebalancing-Pläne in Teilschritten weiterführen (Warteschlange)
    let rebalanceMore = false;
    if (timeLeft() > 25_000) {
      try {
        const r = await runRebalance(admin, ownerId, started + DEADLINE_MS - 15_000, (m) => step(m));
        rebalanceMore = r.more;
      } catch (e) {
        failed.push(`Rebalancing: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    step("Rebalancing fertig");
    // 4. Speicherverlauf (ein Eintrag pro Tag)
    const { data: accs } = await admin.from("accounts").select("quota_usage, quota_limit").eq("owner_id", ownerId).eq("status", "active");
    const { count } = await admin
      .from("items")
      .select("drive_id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("is_folder", false)
      .not("path", "is", null);
    await admin.from("usage_snapshots").upsert({
      owner_id: ownerId,
      day: new Date().toISOString().slice(0, 10),
      usage: (accs ?? []).reduce((s, a) => s + Number(a.quota_usage ?? 0), 0),
      quota: (accs ?? []).reduce((s, a) => s + Number(a.quota_limit ?? 0), 0),
      files: count ?? 0,
    });

    const parts = [`${changed} Änderungen`];
    if (purged) parts.push(`${purged} aus dem Papierkorb gelöscht`);
    if (expired) parts.push(`${expired} abgelaufene Links entfernt`);
    if (rebalanceMore) parts.push("Rebalancing läuft weiter");
    if (unfinished.length) parts.push(`noch nicht fertig: ${unfinished.join(", ")} (geht beim nächsten Abgleich weiter)`);
    await admin.from("activity_log").insert({
      owner_id: ownerId,
      kind: failed.length ? "error" : "sync",
      message: `Nächtlicher Abgleich: ${parts.join(", ")}`,
      details: failed.length ? { fehler: failed } : null,
    });

    step("fertig");
    return json({ changed, purged, expired, failed, unfinished, ms: Date.now() - started });
  } catch (e) {
    return errorResponse(e);
  }
});
