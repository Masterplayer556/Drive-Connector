// Startet das Verbinden eines Google-Kontos: liefert die Google-Login-URL.
import { adminClient, requireOwner } from "../_shared/auth.ts";
import { signState } from "../_shared/crypto.ts";
import { callbackUrl, clientCreds, SCOPES } from "../_shared/google.ts";
import { errorResponse, HttpError, json, preflight } from "../_shared/http.ts";

function validReturnUrl(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "returnTo fehlt");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, "returnTo ist ungültig");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new HttpError(400, "returnTo muss https sein");
  }
  url.hash = "";
  url.search = "";
  return url.toString();
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const admin = adminClient();
    const user = await requireOwner(req, admin);
    const body = await req.json().catch(() => ({}));
    const ret = validReturnUrl(body.returnTo);
    const { id } = clientCreds();

    const state = await signState({ uid: user.id, ret, exp: Date.now() + 15 * 60 * 1000, n: crypto.randomUUID() });
    const params = new URLSearchParams({
      client_id: id,
      redirect_uri: callbackUrl(),
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent select_account",
      include_granted_scopes: "false",
      state,
    });
    return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  } catch (e) {
    return errorResponse(e);
  }
});
