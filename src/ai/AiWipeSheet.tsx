// KI-SUCHE: KI-Daten von diesem Gerät löschen – eigenes Fenster unter Mehr → Sicherheit, nur mit 2FA-Code.
import "./ai.css";
import { useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";
import { useUI } from "../components/ui";
import { supabase } from "../lib/supabase";
import { forgetOldSettings } from "./engine";
import { setAiEnabled } from "./flag";
import { stopIndexer } from "./indexer";
import { usedBytes, wipeEverything } from "./store";
import { wipeCloudFeedback } from "./feedbackCloud";

const mb = (b: number) => `${Math.round(b / 1e6).toLocaleString("de-CH")} MB`;

export default function AiWipeSheet({ factorId, onClose }: { factorId: string | null; onClose: () => void }) {
  const ui = useUI();
  const [bytes, setBytes] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void usedBytes().then(setBytes);
    const t = setTimeout(() => input.current?.focus(), 150);
    return () => clearTimeout(t);
  }, []);

  const wipe = async () => {
    if (!factorId || code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      // 2FA-Code prüfen – erst danach wird gelöscht
      const { error: e } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (e) {
        setError("Code falsch oder abgelaufen – neuen Code eingeben");
        setCode("");
        return;
      }
      stopIndexer();
      setAiEnabled(false);
      forgetOldSettings();
      await wipeEverything();
      await wipeCloudFeedback(); // gesicherte Namen und 👍/👎 auch aus der Datenbank
      ui.toast("KI-Daten gelöscht", "ok");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="sheet-backdrop" onClick={() => !busy && onClose()} />
      <div className="sheet">
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div style={{ minWidth: 0 }}>
            <div className="muted small">Sicherheit</div>
            <h2>KI-Daten löschen</h2>
          </div>
          {!busy && (
            <button className="icon-btn" onClick={onClose} aria-label="Schliessen">
              <Icon name="x" />
            </button>
          )}
        </div>
        <div className="sheet-body">
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void wipe();
            }}
          >
            <p className="muted" style={{ margin: 0 }}>
              Modell und gelernte Fotos werden von diesem Gerät gelöscht
              {bytes !== null && bytes >= 1e6 ? ` (${mb(bytes)})` : ""}, 👍/👎 und gelernte Namen auch aus der Sicherung
              (also auf allen Geräten). Beim nächsten Einschalten lädt und lernt die KI alles neu. Deine Fotos und Tags bleiben
              unverändert.
            </p>
            {factorId ? (
              <>
                <label className="stack" style={{ gap: 4 }}>
                  <span className="faint small">Code aus deiner Authenticator-App</span>
                  <input
                    ref={input}
                    className="input code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    disabled={busy}
                  />
                </label>
                {error && <p className="error small">{error}</p>}
                <button type="submit" className="btn danger-solid block" disabled={code.length !== 6 || busy}>
                  {busy ? <span className="spinner" /> : <Icon name="trash" size={18} />} KI-Daten löschen
                </button>
              </>
            ) : (
              <p className="banner warn" style={{ margin: 0, width: "100%" }}>
                <Icon name="shield" size={18} />
                <span>Zum Löschen zuerst den Zwei-Faktor-Schutz einrichten (gleich darunter).</span>
              </p>
            )}
          </form>
        </div>
      </div>
    </>
  );
}
