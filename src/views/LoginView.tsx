import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

export default function LoginView() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(error.message === "Invalid login credentials" ? "E-Mail oder Passwort falsch" : error.message);
    setBusy(false);
  };

  return (
    <div className="auth">
      <form className="auth-card glass" onSubmit={submit}>
        <img src="./icons/icon-192.png" alt="" className="logo" />
        <h1 className="grad-text">Drive Pool</h1>
        <p className="sub">Alle deine Drives. Ein Ort.</p>
        <input
          className="input"
          type="email"
          autoComplete="username"
          placeholder="E-Mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          placeholder="Passwort"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="error small">{error}</p>}
        <button className="btn primary" disabled={busy}>
          {busy ? <span className="spinner" /> : "Anmelden"}
        </button>
      </form>
    </div>
  );
}
