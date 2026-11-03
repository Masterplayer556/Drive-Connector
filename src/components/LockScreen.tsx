import { useState } from "react";
import { lockError, unlock } from "../lib/lock";
import { supabase } from "../lib/supabase";
import Icon from "./Icon";

export default function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      if (await unlock()) onUnlock();
      else setError("Face ID hat nicht geklappt – nochmals versuchen");
    } catch (e) {
      setError(lockError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth lock-screen">
      <div className="auth-card glass">
        <img src="./icons/icon-192.png" alt="" className="logo" />
        <h1 className="grad-text">Drive Pool</h1>
        <p className="sub">Gesperrt</p>
        <button className="btn primary" disabled={busy} onClick={go}>
          {busy ? <span className="spinner" /> : <Icon name="faceId" size={22} />} Mit Face ID entsperren
        </button>
        {error && <p className="error small" style={{ textAlign: "center" }}>{error}</p>}
        <button className="btn ghost" onClick={() => supabase.auth.signOut()}>
          Mit Passwort anmelden
        </button>
      </div>
    </div>
  );
}
