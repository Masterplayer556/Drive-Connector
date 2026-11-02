import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";

let adminSingleton: SupabaseClient | null = null;

export function adminClient(): SupabaseClient {
  if (adminSingleton) return adminSingleton;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY fehlt");
  adminSingleton = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return adminSingleton;
}

// Zwischenspeicher pro warmer Funktions-Instanz → kein Datenbank-Aufruf pro Anfrage
let ownerId: string | null = null;
const factorCache = new Map<string, { has: boolean; at: number }>();
const FACTOR_TTL = 5 * 60 * 1000;

async function hasVerifiedFactor(admin: SupabaseClient, userId: string): Promise<boolean> {
  const hit = factorCache.get(userId);
  if (hit && Date.now() - hit.at < FACTOR_TTL) return hit.has;
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
  if (error) throw error;
  const has = (data?.factors ?? []).some((f) => f.status === "verified");
  factorCache.set(userId, { has, at: Date.now() });
  return has;
}

/**
 * Prüft das Supabase-Login (Signatur lokal über JWKS) und stellt sicher, dass nur der Besitzer
 * der App Zugriff hat. Der erste angemeldete Nutzer, der eine Funktion aufruft, wird zum Besitzer.
 * Hat der Nutzer 2FA eingerichtet, muss die Sitzung bestätigt sein (aal2).
 */
export async function requireOwner(req: Request, admin: SupabaseClient): Promise<{ id: string }> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Nicht angemeldet");

  const { data, error } = await admin.auth.getClaims(token);
  const claims = data?.claims as { sub?: string; aal?: string; role?: string } | undefined;
  if (error || !claims?.sub || claims.role !== "authenticated") throw new HttpError(401, "Nicht angemeldet");
  const userId = claims.sub;

  if (claims.aal !== "aal2" && (await hasVerifiedFactor(admin, userId))) {
    throw new HttpError(403, "Zwei-Faktor-Bestätigung nötig");
  }

  if (!ownerId) {
    const { data: owner, error: ownerError } = await admin.from("app_owner").select("user_id").maybeSingle();
    if (ownerError) throw ownerError;
    if (owner) {
      ownerId = owner.user_id;
    } else {
      const { error: insertError } = await admin.from("app_owner").insert({ singleton: true, user_id: userId });
      if (insertError) {
        const { data: again } = await admin.from("app_owner").select("user_id").maybeSingle();
        ownerId = again?.user_id ?? null;
      } else {
        ownerId = userId;
      }
    }
  }
  if (ownerId !== userId) throw new HttpError(403, "Diese App gehört einem anderen Nutzer");
  return { id: userId };
}
