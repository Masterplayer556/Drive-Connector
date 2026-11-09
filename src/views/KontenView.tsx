import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { clearPending, readPending } from "../lib/newaccount";
import Donut from "../components/Donut";
import Icon from "../components/Icon";
import Segmented from "../components/Segmented";
import StorageBar from "../components/StorageBar";
import Topbar from "../components/Topbar";
import { useUI } from "../components/ui";
import { AREA_LABEL, ROLES } from "../lib/areas";
import { invalidateAll } from "../lib/cache";
import { fetchAccounts, setAccountRole, syncAccounts } from "../lib/db";
import { formatBytes, formatDateTime } from "../lib/format";
import { clearParams } from "../lib/route";
import { callFunction } from "../lib/supabase";
import { accountColor } from "../lib/theme";
import type { Account, Role } from "../lib/types";

const NewAccountSheet = lazy(() => import("../components/NewAccountSheet"));

export default function KontenView({
  accounts,
  params,
  reload,
}: {
  accounts: Account[];
  params: URLSearchParams;
  reload: () => Promise<void>;
}) {
  const ui = useUI();
  const [busy, setBusy] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const handled = useRef(false);

  const sync = async (ids?: string[]) => {
    setBusy("Synchronisiere …");
    try {
      const results = await syncAccounts(ids);
      const failed = results.filter((r) => r.error);
      if (failed.length) ui.toast(failed.map((f) => `${f.email}: ${f.error}`).join("\n"), "error");
      else {
        const changes = results.reduce((s, r) => s + (r.changed ?? 0), 0);
        ui.toast(changes ? `${changes} Änderungen übernommen` : "Alles aktuell", "ok");
      }
      invalidateAll();
      await reload();
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
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
    if (failed) ui.toast(failed, "error");
    else {
      ui.toast(`${connected} verbunden`, "ok");
      void (async () => {
        // Über den Assistenten „Neues Google-Konto“ erstellt → gleich in den gewählten Bereich
        const pending = readPending();
        if (pending && connected && pending.email.toLowerCase() === connected.toLowerCase()) {
          clearPending();
          try {
            const acc = (await fetchAccounts()).find((a) => a.email.toLowerCase() === connected.toLowerCase());
            if (acc && acc.role !== pending.role) await setAccountRole(acc.id, pending.role);
          } catch (e) {
            ui.toast(e instanceof Error ? e.message : String(e), "error");
          }
        }
        await sync();
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const connect = async () => {
    setBusy("Weiterleitung zu Google …");
    try {
      const { url } = await callFunction<{ url: string }>("google-connect", {
        returnTo: window.location.origin + window.location.pathname,
      });
      window.location.href = url;
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
      setBusy(null);
    }
  };

  const changeRole = async (a: Account, role: Role) => {
    if (a.role === role) return;
    try {
      await setAccountRole(a.id, role);
      await reload();
      ui.toast(`${a.email} → ${AREA_LABEL[role]}`, "ok");
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const active = accounts.filter((a) => a.status === "active");
  const total = active.reduce((s, a) => s + (a.quota_limit ?? 0), 0);
  const used = active.reduce((s, a) => s + (a.quota_usage ?? 0), 0);

  return (
    <div className="view page-fade">
      <Topbar
        eyebrow={`${accounts.length} verbunden`}
        title="Konten"
        right={
          <button className="icon-btn" disabled={!!busy} onClick={() => sync()} aria-label="Synchronisieren">
            {busy ? <span className="spinner" /> : <Icon name="refresh" />}
          </button>
        }
      />

      {accounts.length > 0 && (
        <section className="card glass enter">
          <div className="hero">
            <Donut
              size={112}
              total={total}
              segments={accounts.map((a, i) => ({
                value: a.status === "active" ? a.quota_usage ?? 0 : 0,
                color: accountColor(i),
                label: a.email,
              }))}
            />
            <div className="hero-info">
              <div className="muted small">Gesamtspeicher</div>
              <div className="hero-big">{formatBytes(total)}</div>
              <div className="muted small">{formatBytes(Math.max(0, total - used))} frei</div>
            </div>
          </div>
        </section>
      )}

      <div className="stagger">
        {accounts.map((a, i) => (
          <section key={a.id} className="card glass account-card" style={{ ["--i" as string]: i }}>
            <div className="account-head">
              <div className="avatar" style={{ background: accountColor(i) }}>
                {a.email.slice(0, 1).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ellipsis" style={{ fontWeight: 600 }}>
                  {a.email}
                </div>
                <span className={`status-pill ${a.status === "error" ? "err" : ""}`}>
                  {a.status === "error" ? "Fehler" : `Sync ${formatDateTime(a.last_sync_at)}`}
                </span>
              </div>
            </div>
            <StorageBar used={a.quota_usage ?? 0} total={a.quota_limit ?? 0} color={accountColor(i)} />
            <div className="row between">
              <span className="muted small">Bereich</span>
              <Segmented
                value={a.role}
                onChange={(r) => changeRole(a, r)}
                options={ROLES.map((r) => ({ value: r, label: AREA_LABEL[r] }))}
              />
            </div>
            {a.status === "error" && (
              <>
                <div className="error small">{a.status_message ?? "Fehler"}</div>
                <button className="btn small" onClick={connect}>
                  <Icon name="link" size={16} /> Neu verbinden
                </button>
              </>
            )}
          </section>
        ))}
      </div>

      <div className="stack pad" style={{ marginTop: 8 }}>
        <button className="btn primary block" disabled={!!busy} onClick={connect}>
          {busy === "Weiterleitung zu Google …" ? <span className="spinner" /> : <Icon name="plus" size={19} />}
          Konto verbinden
        </button>
        <button className="btn block" disabled={!!busy} onClick={() => setNewOpen(true)}>
          <Icon name="sparkles" size={18} /> Neues Google-Konto erstellen
        </button>
        <p className="faint small" style={{ textAlign: "center" }}>
          Google zeigt „nicht überprüft“ → „Erweitert“ → „Weiter zu Drive Pool“ und das Drive-Häkchen setzen.
        </p>
      </div>
      {newOpen && (
        <Suspense fallback={null}>
          <NewAccountSheet
            accounts={accounts}
            onConnect={() => {
              setNewOpen(false);
              void connect();
            }}
            onClose={() => setNewOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
