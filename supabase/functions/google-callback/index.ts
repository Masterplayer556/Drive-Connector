// Google leitet nach dem Login hierher zurück. Tauscht den Code gegen Tokens,
// speichert das Konto und leitet zurück in die App.
import { adminClient } from "../_shared/auth.ts";
import { encrypt, verifyState } from "../_shared/crypto.ts";
import { DRIVE, exchangeCode, gfetch } from "../_shared/google.ts";

function page(message: string, status = 400): Response {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Drive Pool</title><body style="font-family:system-ui;padding:24px"><h1>Drive Pool</h1><p>${message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")}</p></body>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const state = await verifyState(url.searchParams.get("state"));
  if (!state) return page("Ungültige oder abgelaufene Anfrage. Bitte in der App erneut auf „Konto verbinden“ tippen.");

  const back = (params: Record<string, string>) =>
    new Response(null, { status: 302, headers: { Location: `${state.ret}#/konten?${new URLSearchParams(params)}` } });

  const googleError = url.searchParams.get("error");
  if (googleError) {
    return back({ fehler: googleError === "access_denied" ? "Verbinden abgebrochen" : `Google: ${googleError}` });
  }
  const code = url.searchParams.get("code");
  if (!code) return back({ fehler: "Kein Code von Google erhalten" });

  try {
    const admin = adminClient();
    const { data: owner } = await admin.from("app_owner").select("user_id").maybeSingle();
    if (!owner || owner.user_id !== state.uid) return back({ fehler: "Nicht erlaubt" });

    const tokens = await exchangeCode(code);
    if (!tokens.scope?.includes("https://www.googleapis.com/auth/drive")) {
      return back({ fehler: "Der Drive-Zugriff wurde nicht erlaubt. Bitte beim Verbinden alle Häkchen setzen." });
    }

    const info = await gfetch<{ sub: string; email: string }>(
      tokens.access_token,
      "https://openidconnect.googleapis.com/v1/userinfo",
    );
    const root = await gfetch<{ id: string }>(tokens.access_token, `${DRIVE}/files/root?fields=id`);
    const about = await gfetch<{ storageQuota: { limit?: string; usage?: string } }>(
      tokens.access_token,
      `${DRIVE}/about?fields=storageQuota`,
    );

    const { data: account, error } = await admin
      .from("accounts")
      .upsert(
        {
          owner_id: state.uid,
          google_sub: info.sub,
          email: info.email,
          root_folder_id: root.id,
          quota_limit: about.storageQuota.limit ? Number(about.storageQuota.limit) : null,
          quota_usage: about.storageQuota.usage ? Number(about.storageQuota.usage) : null,
          quota_updated_at: new Date().toISOString(),
          status: "active",
          status_message: null,
        },
        { onConflict: "owner_id,google_sub" },
      )
      .select("id")
      .single();
    if (error) throw error;

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    if (tokens.refresh_token) {
      const { error: secretError } = await admin.from("account_secrets").upsert({
        account_id: account.id,
        refresh_token_enc: await encrypt(tokens.refresh_token),
        access_token_enc: await encrypt(tokens.access_token),
        access_token_expires_at: expiresAt,
      });
      if (secretError) throw secretError;
    } else {
      const { data: existing } = await admin
        .from("account_secrets")
        .select("account_id")
        .eq("account_id", account.id)
        .maybeSingle();
      if (!existing) {
        return back({
          fehler:
            "Google hat keinen dauerhaften Zugriff geliefert. Entferne „Drive Pool“ unter myaccount.google.com → Sicherheit → Drittanbieter-Zugriff und verbinde erneut.",
        });
      }
    }

    await admin.from("activity_log").insert({
      owner_id: state.uid,
      kind: "account",
      message: `Konto ${info.email} verbunden`,
    });

    return back({ verbunden: info.email });
  } catch (e) {
    console.error(e);
    return back({ fehler: e instanceof Error ? e.message : "Unbekannter Fehler" });
  }
});
