import { useEffect, useRef, useState } from "react";
import StorageBar from "../components/StorageBar";
import { setAccountRole, syncAccounts, type SyncResult } from "../lib/db";
import { formatDateTime } from "../lib/format";
import { clearParams } from "../lib/route";
import { callFunction } from "../lib/supabase";
import type { Account, Role } from "../lib/types";

export default function KontenView({
  accounts,
  params,
  reload,
}: {
  accounts: Account[];
  params: URLSearchParams;
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  const sync = async (ids?: string[], full = false) => {
    setBusy(full ? "Lese alles neu ein … (kann etwas dauern)" : "Synchronisiere …");
    setError(null);
    try {
      const results: SyncResult[] = await syncAccounts(ids, full);
      const failed = results.filter((r) => r.error);
      if (failed.length) setError(failed.map((f) => `${f.email}: ${f.error}`).join("\n"));
      else setMessage(`Synchronisiert: ${results.map((r) => `${r.email} (${r.changed ?? 0} Änderungen)`).join(", ")}`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // Rückkehr vom Google-Login
  useEffect(() => {
    if (handled.current) return;
    const connected = params.get("verbunden");
    const failed = params.get("fehler");
    if (!connected && !failed) return;
    handled.current = true;
    clearParams("konten");
    if (failed) {
      setError(failed);
    } else {
      setMessage(`${connected} verbunden – lese Dateien ein …`);
      void sync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const connect = async () => {
    setBusy("Weiterleitung zu Google …");
    setError(null);
    try {
      const { url } = await callFunction<{ url: string }>("google-connect", {
        returnTo: window.location.origin + window.location.pathname,
      });
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const changeRole = async (a: Account, role: Role) => {
    try {
      await setAccountRole(a.id, role);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const active = accounts.filter((a) => a.status === "active");
  const total = active.reduce((s, a) => s + (a.quota_limit ?? 0), 0);
  const used = active.reduce((s, a) => s + (a.quota_usage ?? 0), 0);

  return (
    <div className="view">
      <header className="header">
        <h2>Konten</h2>
      </header>

      {message && (
        <div className="banner ok" onClick={() => setMessage(null)}>
          {message}
        </div>
      )}
      {error && (
        <div className="banner error pre" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {busy && <div className="banner">{busy}</div>}

      <section className="card">
        <StorageBar used={used} total={total} label={`Gesamt · ${active.length} Konten`} />
      </section>

      {accounts.map((a) => (
        <section key={a.id} className={`card stack ${a.status === "error" ? "card-error" : ""}`}>
          <div className="row between">
            <strong className="ellipsis">{a.email}</strong>
            <div className="segmented">
              {(["schule", "privat"] as Role[]).map((r) => (
                <button key={r} className={a.role === r ? "on" : ""} onClick={() => changeRole(a, r)}>
                  {r === "schule" ? "Schule" : "Privat"}
                </button>
              ))}
            </div>
          </div>
          <StorageBar used={a.quota_usage ?? 0} total={a.quota_limit ?? 0} />
          <div className="muted small">Zuletzt synchronisiert: {formatDateTime(a.last_sync_at)}</div>
          {a.status === "error" && (
            <div className="stack">
              <div className="error small">{a.status_message ?? "Fehler"}</div>
              <button className="btn small" onClick={connect}>
                Neu verbinden
              </button>
            </div>
          )}
        </section>
      ))}

      <div className="stack pad">
        <button className="btn primary" disabled={!!busy} onClick={connect}>
          ＋ Konto verbinden
        </button>
        {accounts.length > 0 && (
          <button className="btn" disabled={!!busy} onClick={() => sync()}>
            🔄 Jetzt synchronisieren
          </button>
        )}
        <p className="muted small">
          Beim Verbinden zeigt Google „Google hat diese App nicht überprüft“. Tippe auf „Erweitert“ → „Weiter zu Drive
          Pool“ und erlaube den Zugriff auf Google Drive.
        </p>
      </div>
    </div>
  );
}
