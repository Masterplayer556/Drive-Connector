import { useState, type FormEvent } from "react";
import Icon from "../components/Icon";
import { supabase } from "../lib/supabase";

export default function MfaView({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      const factor = data.totp.find((f) => f.status === "verified");
      if (!factor) throw new Error("Kein 2FA-Faktor gefunden");
      const r = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
      if (r.error) throw r.error;
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form className="auth-card glass" onSubmit={submit}>
        <div className="empty-icon" style={{ alignSelf: "center" }}>
          <Icon name="shield" size={34} />
        </div>
        <h1>Bestätigung</h1>
        <p className="sub">Code aus deiner Authenticator-App</p>
        <input
          className="input code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          autoFocus
        />
        {error && <p className="error small">{error}</p>}
        <button className="btn primary" disabled={busy || code.length !== 6}>
          {busy ? <span className="spinner" /> : "Bestätigen"}
        </button>
        <button type="button" className="btn ghost" onClick={() => supabase.auth.signOut()}>
          Abmelden
        </button>
      </form>
    </div>
  );
}
