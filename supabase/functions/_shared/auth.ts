import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";

export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY fehlt");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function jwtClaim(token: string, claim: string): unknown {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((payload.length + 3) % 4));
    return JSON.parse(json)[claim];
  } catch {
    return undefined;
  }
}

/**
 * Prüft das Supabase-Login und stellt sicher, dass nur der Besitzer der App Zugriff hat.
 * Der erste angemeldete Nutzer, der eine Funktion aufruft, wird zum Besitzer.
 * Hat der Nutzer 2FA eingerichtet, muss die Sitzung bestätigt sein (aal2).
 */
export async function requireOwner(req: Request, admin: SupabaseClient): Promise<User> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Nicht angemeldet");

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Nicht angemeldet");
  const user = data.user;

  const verifiedFactors = (user.factors ?? []).filter((f) => f.status === "verified");
  if (verifiedFactors.length > 0 && jwtClaim(token, "aal") !== "aal2") {
    throw new HttpError(403, "Zwei-Faktor-Bestätigung nötig");
  }

  const { data: owner, error: ownerError } = await admin.from("app_owner").select("user_id").maybeSingle();
  if (ownerError) throw ownerError;
  if (!owner) {
    const { error: insertError } = await admin.from("app_owner").insert({ singleton: true, user_id: user.id });
    if (insertError) {
      const { data: again } = await admin.from("app_owner").select("user_id").maybeSingle();
      if (again?.user_id !== user.id) throw new HttpError(403, "Diese App gehört einem anderen Nutzer");
    }
  } else if (owner.user_id !== user.id) {
    throw new HttpError(403, "Diese App gehört einem anderen Nutzer");
  }
  return user;
}
