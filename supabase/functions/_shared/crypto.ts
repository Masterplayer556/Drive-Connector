// Verschlüsselung der Google-Tokens (AES-GCM) und Signatur des OAuth-"state" (HMAC).
// Der Schlüssel wird aus TOKEN_ENC_KEY abgeleitet, sonst aus dem Service-Role-Key des Projekts.

const enc = new TextEncoder();
const dec = new TextDecoder();

let keysPromise: Promise<{ aes: CryptoKey; hmac: CryptoKey }> | null = null;

function keys() {
  if (!keysPromise) {
    keysPromise = (async () => {
      const secret = Deno.env.get("TOKEN_ENC_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!secret) throw new Error("Kein Schlüssel für die Token-Verschlüsselung vorhanden");
      const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
      const salt = enc.encode("drive-pool");
      const aes = await crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt, info: enc.encode("token-encryption") },
        base,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
      const hmac = await crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt, info: enc.encode("oauth-state") },
        base,
        { name: "HMAC", hash: "SHA-256", length: 256 },
        false,
        ["sign", "verify"],
      );
      return { aes, hmac };
    })();
  }
  return keysPromise;
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const toB64Url = (bytes: Uint8Array) => toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64Url = (s: string): Uint8Array<ArrayBuffer> => fromB64(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));

export async function encrypt(plain: string): Promise<string> {
  const { aes } = await keys();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, enc.encode(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toB64(out);
}

export async function decrypt(b64: string): Promise<string> {
  const { aes } = await keys();
  const data = fromB64(b64);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.slice(0, 12) }, aes, data.slice(12));
  return dec.decode(plain);
}

export interface OAuthState {
  uid: string;
  ret: string;
  exp: number;
  n: string;
}

export async function signState(state: OAuthState): Promise<string> {
  const { hmac } = await keys();
  const payload = toB64Url(enc.encode(JSON.stringify(state)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", hmac, enc.encode(payload)));
  return `${payload}.${toB64Url(sig)}`;
}

export async function verifyState(value: string | null): Promise<OAuthState | null> {
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  const { hmac } = await keys();
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", hmac, fromB64Url(sig), enc.encode(payload));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const state = JSON.parse(dec.decode(fromB64Url(payload))) as OAuthState;
    if (typeof state.exp !== "number" || state.exp < Date.now()) return null;
    return state;
  } catch {
    return null;
  }
}
