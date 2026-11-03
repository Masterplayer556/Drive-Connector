// Face-ID-Sperre (#12) über einen Passkey des iPhones (WebAuthn, Plattform-Authenticator).
// Das Supabase-Login bleibt bestehen; beim Öffnen der App entsperrt Face ID statt Passwort + Code.

const KEY = "drivepool.lock";
const RELOCK_AFTER_MS = 60_000;

interface LockPrefs {
  credId: string;
}

const toB64Url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64Url = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const challenge = () => crypto.getRandomValues(new Uint8Array(32));

export function lockEnabled(): boolean {
  try {
    return !!JSON.parse(localStorage.getItem(KEY) ?? "null")?.credId;
  } catch {
    return false;
  }
}

export async function lockSupported(): Promise<boolean> {
  try {
    return !!(await window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.());
  } catch {
    return false;
  }
}

/** Verständliche Meldung für WebAuthn-Fehler. */
export function lockError(e: unknown): string {
  const name = (e as Error)?.name;
  if (name === "NotAllowedError") return "Abgebrochen – nochmals versuchen";
  if (name === "InvalidStateError") return "Für diese App gibt es schon einen Passkey – nochmals versuchen";
  if (name === "SecurityError") return "Face ID geht nur über die sichere Web-Adresse der App";
  if (name === "NotSupportedError") return "Face ID wird hier nicht unterstützt";
  return (e as Error)?.message || "Face ID hat nicht geklappt";
}

/** Face ID einrichten: legt einen Passkey nur für diese App auf dem iPhone an. */
export async function enableLock(email: string): Promise<void> {
  if (!window.PublicKeyCredential || !navigator.credentials) throw new Error("Face ID wird in diesem Browser nicht unterstützt");
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: challenge(),
      rp: { name: "Drive Pool", id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: email, displayName: `Drive Pool (${email})` },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Face ID wurde nicht eingerichtet");
  localStorage.setItem(KEY, JSON.stringify({ credId: toB64Url(cred.rawId) } satisfies LockPrefs));
}

export function disableLock() {
  localStorage.removeItem(KEY);
}

/** Face ID abfragen. */
export async function unlock(): Promise<boolean> {
  const prefs = JSON.parse(localStorage.getItem(KEY) ?? "null") as LockPrefs | null;
  if (!prefs) return true;
  const res = await navigator.credentials.get({
    publicKey: {
      challenge: challenge(),
      rpId: location.hostname,
      allowCredentials: [{ type: "public-key", id: fromB64Url(prefs.credId) }],
      userVerification: "required",
      timeout: 60_000,
    },
  });
  return !!res;
}

/** Nach einer Minute im Hintergrund wieder sperren. */
export function watchRelock(onLock: () => void): () => void {
  let hiddenAt = 0;
  const handler = () => {
    if (document.visibilityState === "hidden") hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > RELOCK_AFTER_MS && lockEnabled()) onLock();
  };
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}
