import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { syncAccounts } from "../lib/db";
import { navigate } from "../lib/route";
import { supabase } from "../lib/supabase";

interface Enroll {
  factorId: string;
  qr: string;
  secret: string;
}

export default function MehrView({ session }: { session: Session }) {
  const [hasMfa, setHasMfa] = useState<boolean | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<Enroll | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadFactors = async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) return setError(error.message);
    const f = data.totp.find((x) => x.status === "verified");
    setHasMfa(!!f);
    setFactorId(f?.id ?? null);
  };

  useEffect(() => {
    void loadFactors();
  }, []);

  const startEnroll = async () => {
    setError(null);
    // Unbestätigte alte Versuche entfernen
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of list?.all ?? []) {
      if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Drive Pool" });
    if (error) return setError(error.message);
    setEnroll({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };

  const confirmEnroll = async () => {
    if (!enroll) return;
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll.factorId, code: code.trim() });
    if (error) return setError(error.message);
    setEnroll(null);
    setCode("");
    setMessage("Zwei-Faktor-Schutz ist aktiv.");
    await loadFactors();
  };

  const removeMfa = async () => {
    if (!factorId || !window.confirm("Zwei-Faktor-Schutz wirklich entfernen?")) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) return setError(error.message);
    setMessage("Zwei-Faktor-Schutz entfernt.");
    await loadFactors();
  };

  const fullSync = async () => {
    if (!window.confirm("Alle Konten komplett neu einlesen? Das kann ein paar Minuten dauern.")) return;
    setBusy("Lese alles neu ein …");
    setError(null);
    try {
      const r = await syncAccounts(undefined, true);
      const failed = r.filter((x) => x.error);
      if (failed.length) setError(failed.map((f) => `${f.email}: ${f.error}`).join("\n"));
      else setMessage("Alle Konten neu eingelesen.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="view">
      <header className="header">
        <h2>Mehr</h2>
      </header>
      {message && <div className="banner ok">{message}</div>}
      {error && <div className="banner error pre">{error}</div>}
      {busy && <div className="banner">{busy}</div>}

      <section className="card stack">
        <div className="muted small">Angemeldet als</div>
        <div>{session.user.email}</div>
      </section>

      <section className="card stack">
        <strong>Ordner</strong>
        <button className="btn" onClick={() => navigate("einrichtung")}>
          🧭 Einrichtung (Schule / Privat zuordnen)
        </button>
        <button className="btn" disabled={!!busy} onClick={fullSync}>
          🔄 Alle Konten komplett neu einlesen
        </button>
      </section>

      <section className="card stack">
        <strong>Zwei-Faktor-Schutz (2FA)</strong>
        {hasMfa === null ? (
          <span className="muted">Lädt …</span>
        ) : hasMfa ? (
          <>
            <span className="muted small">Aktiv – beim Anmelden wird ein Code aus deiner Authenticator-App verlangt.</span>
            <button className="btn danger" onClick={removeMfa}>
              2FA entfernen
            </button>
          </>
        ) : enroll ? (
          <>
            <span className="muted small">
              Scanne den QR-Code mit einer Authenticator-App (z. B. Passwörter-App auf dem iPhone, Google Authenticator)
              oder gib den Schlüssel ein.
            </span>
            <img className="qr" src={enroll.qr} alt="QR-Code" />
            <code className="secret">{enroll.secret}</code>
            <input
              className="input code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="6-stelliger Code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <button className="btn primary" disabled={code.length !== 6} onClick={confirmEnroll}>
              Bestätigen
            </button>
          </>
        ) : (
          <>
            <span className="muted small">Empfohlen: Die App hat Vollzugriff auf alle deine Drives.</span>
            <button className="btn" onClick={startEnroll}>
              2FA einrichten
            </button>
          </>
        )}
      </section>

      <div className="stack pad">
        <button className="btn ghost" onClick={() => supabase.auth.signOut()}>
          Abmelden
        </button>
        <p className="muted small center-text">Drive Pool · Phase 1</p>
      </div>
    </div>
  );
}
