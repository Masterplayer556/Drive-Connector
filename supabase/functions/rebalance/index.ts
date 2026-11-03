// Rebalancing ausführen (Aufruf aus der App nach „Ausführen“). Arbeitet ~90 s und meldet den Fortschritt;
// die App ruft so lange erneut auf, bis alles erledigt ist. Den Rest übernimmt sonst der nächtliche Job.
import { adminClient, requireOwner } from "../_shared/auth.ts";
import { errorResponse, json, preflight } from "../_shared/http.ts";
import { runRebalance } from "../_shared/rebalance.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const started = Date.now();
    const admin = adminClient();
    const user = await requireOwner(req, admin);
    return json(await runRebalance(admin, user.id, started + 90_000));
  } catch (e) {
    return errorResponse(e);
  }
});
