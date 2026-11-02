import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { decrypt, encrypt } from "./crypto.ts";
import { HttpError } from "./http.ts";

export const DRIVE = "https://www.googleapis.com/drive/v3";
export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const SCOPES = "openid email https://www.googleapis.com/auth/drive";

export function clientCreds(): { id: string; secret: string } {
  const id = Deno.env.get("GOOGLE_CLIENT_ID");
  const secret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!id || !secret) {
    throw new HttpError(500, "Google-Zugangsdaten fehlen (Secrets GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)");
  }
  return { id, secret };
}

export function callbackUrl(): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/google-callback`;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new HttpError(res.status === 400 ? 409 : 502, body.error_description ?? body.error ?? "Google-Token-Fehler");
    (err as HttpError & { code?: string }).code = body.error;
    throw err;
  }
  return body as TokenResponse;
}

export function exchangeCode(code: string): Promise<TokenResponse> {
  const { id, secret } = clientCreds();
  return tokenRequest({
    code,
    client_id: id,
    client_secret: secret,
    redirect_uri: callbackUrl(),
    grant_type: "authorization_code",
  });
}

/** Ruft eine Google-API auf und gibt JSON zurück. */
export async function gfetch<T = Record<string, unknown>>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30_000), // nie endlos auf Google warten
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new HttpError(res.status, `Google ${res.status}: ${body?.error?.message ?? res.statusText}`);
  }
  return (await res.json()) as T;
}

const memTokens = new Map<string, { token: string; expiresAt: string }>();

/**
 * Liefert ein gültiges Access-Token für ein Konto. Erneuert es bei Bedarf mit dem Refresh-Token
 * und speichert es verschlüsselt zwischen (Datenbank + Speicher der warmen Instanz).
 */
export async function getAccessToken(
  admin: SupabaseClient,
  accountId: string,
): Promise<{ token: string; expiresAt: string }> {
  // 1. Im Speicher der warmen Instanz
  const mem = memTokens.get(accountId);
  if (mem && Date.parse(mem.expiresAt) - Date.now() > 3 * 60 * 1000) return mem;
  const fresh = await loadAccessToken(admin, accountId);
  memTokens.set(accountId, fresh);
  return fresh;
}

async function loadAccessToken(
  admin: SupabaseClient,
  accountId: string,
): Promise<{ token: string; expiresAt: string }> {
  const { data: secret, error } = await admin
    .from("account_secrets")
    .select("refresh_token_enc, access_token_enc, access_token_expires_at")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) throw error;
  if (!secret) throw new HttpError(409, "Für dieses Konto fehlt der Zugriff – bitte neu verbinden");

  if (secret.access_token_enc && secret.access_token_expires_at) {
    const expires = new Date(secret.access_token_expires_at).getTime();
    if (expires - Date.now() > 3 * 60 * 1000) {
      try {
        return { token: await decrypt(secret.access_token_enc), expiresAt: secret.access_token_expires_at };
      } catch {
        // Schlüssel geändert – unten neu holen
      }
    }
  }

  let refreshToken: string;
  try {
    refreshToken = await decrypt(secret.refresh_token_enc);
  } catch {
    await markError(admin, accountId, "Gespeicherter Zugriff unlesbar – bitte neu verbinden");
    throw new HttpError(409, "Gespeicherter Zugriff unlesbar – bitte Konto neu verbinden");
  }

  const { id, secret: clientSecret } = clientCreds();
  let tokens: TokenResponse;
  try {
    tokens = await tokenRequest({
      client_id: id,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
  } catch (e) {
    if ((e as { code?: string }).code === "invalid_grant") {
      await markError(admin, accountId, "Google hat den Zugriff entzogen – bitte neu verbinden");
    }
    throw e;
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  await admin
    .from("account_secrets")
    .update({ access_token_enc: await encrypt(tokens.access_token), access_token_expires_at: expiresAt })
    .eq("account_id", accountId);
  return { token: tokens.access_token, expiresAt };
}

async function markError(admin: SupabaseClient, accountId: string, message: string) {
  await admin.from("accounts").update({ status: "error", status_message: message }).eq("id", accountId);
}
