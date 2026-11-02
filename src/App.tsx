import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { fetchAccounts } from "./lib/db";
import { clearTokens, loadTokens } from "./lib/google";
import { navigate, useRoute, type RouteName } from "./lib/route";
import { supabase } from "./lib/supabase";
import type { Account } from "./lib/types";
import DriveView from "./views/DriveView";
import EinrichtungView from "./views/EinrichtungView";
import KontenView from "./views/KontenView";
import LoginView from "./views/LoginView";
import MehrView from "./views/MehrView";
import MfaView from "./views/MfaView";
import ProtokollView from "./views/ProtokollView";

type Phase = "loading" | "login" | "mfa" | "ready" | "error";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tokenErrors, setTokenErrors] = useState<{ email: string; error: string }[]>([]);
  const route = useRoute();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setPhase("login");
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_OUT") {
        clearTokens();
        setAccounts([]);
        setPhase("login");
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const reloadAccounts = useCallback(async () => {
    setAccounts(await fetchAccounts());
  }, []);

  const start = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
        setPhase("mfa");
        return;
      }
      // Besitzer-Prüfung + Tokens laden
      const { errors } = await loadTokens();
      setTokenErrors(errors);
      await reloadAccounts();
      setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [reloadAccounts]);

  const userId = session?.user.id;
  useEffect(() => {
    if (userId) void start();
  }, [userId, start]);

  if (phase === "loading") return <div className="center muted">Lädt …</div>;
  if (phase === "login" || !session) return <LoginView />;
  if (phase === "mfa") return <MfaView onDone={start} />;
  if (phase === "error") {
    return (
      <div className="center stack">
        <h2>Fehler</h2>
        <p className="muted">{error}</p>
        <button className="btn" onClick={start}>
          Erneut versuchen
        </button>
        <button className="btn ghost" onClick={() => supabase.auth.signOut()}>
          Abmelden
        </button>
      </div>
    );
  }

  const tabs: { name: RouteName; label: string; icon: string }[] = [
    { name: "drive", label: "Drive", icon: "🗂️" },
    { name: "konten", label: "Konten", icon: "☁️" },
    { name: "protokoll", label: "Protokoll", icon: "📜" },
    { name: "mehr", label: "Mehr", icon: "⚙️" },
  ];
  const active = route.name === "einrichtung" ? "mehr" : route.name;

  return (
    <div className="app">
      <main className="main">
        {tokenErrors.length > 0 && route.name !== "konten" && (
          <button className="banner warn" onClick={() => navigate("konten")}>
            ⚠️ {tokenErrors.length} Konto/Konten nicht erreichbar – antippen für Details
          </button>
        )}
        {route.name === "drive" && <DriveView accounts={accounts} />}
        {route.name === "konten" && (
          <KontenView
            accounts={accounts}
            params={route.params}
            reload={async () => {
              const { errors } = await loadTokens();
              setTokenErrors(errors);
              await reloadAccounts();
            }}
          />
        )}
        {route.name === "protokoll" && <ProtokollView />}
        {route.name === "mehr" && <MehrView session={session} />}
        {route.name === "einrichtung" && <EinrichtungView accounts={accounts} reload={reloadAccounts} />}
      </main>
      <nav className="tabbar">
        {tabs.map((t) => (
          <button
            key={t.name}
            className={`tab ${active === t.name ? "active" : ""}`}
            onClick={() => navigate(t.name)}
          >
            <span className="tab-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
