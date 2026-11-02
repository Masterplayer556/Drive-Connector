import type { Session } from "@supabase/supabase-js";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import Icon, { type IconName } from "./components/Icon";
import { LineSkeleton } from "./components/Skeleton";
import Splash from "./components/Splash";
import { UIProvider } from "./components/ui";
import { clearLocalCaches, readCachedAccounts, writeCachedAccounts } from "./lib/cache";
import { fetchAccounts } from "./lib/db";
import { clearTokens, loadTokens } from "./lib/google";
import { navigate, useRoute, type RouteName } from "./lib/route";
import { supabase } from "./lib/supabase";
import type { Account } from "./lib/types";
import DriveView from "./views/DriveView";
import LoginView from "./views/LoginView";
import MfaView from "./views/MfaView";

const KontenView = lazy(() => import("./views/KontenView"));
const ProtokollView = lazy(() => import("./views/ProtokollView"));
const MehrView = lazy(() => import("./views/MehrView"));
const EinrichtungView = lazy(() => import("./views/EinrichtungView"));

type Phase = "loading" | "login" | "mfa" | "ready" | "error";

const TABS: { name: RouteName; label: string; icon: IconName }[] = [
  { name: "drive", label: "Drive", icon: "grid" },
  { name: "konten", label: "Konten", icon: "cloud" },
  { name: "protokoll", label: "Protokoll", icon: "activity" },
  { name: "mehr", label: "Mehr", icon: "sliders" },
];

function Aurora() {
  return (
    <div className="aurora" aria-hidden="true">
      <i />
      <i />
      <i />
    </div>
  );
}

export default function App() {
  return (
    <UIProvider>
      <Aurora />
      <Shell />
    </UIProvider>
  );
}

function Shell() {
  const [session, setSession] = useState<Session | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccountsState] = useState<Account[]>(() => readCachedAccounts() ?? []);
  const [tokenErrors, setTokenErrors] = useState<{ email: string; error: string }[]>([]);
  const route = useRoute();

  const setAccounts = useCallback((list: Account[]) => {
    setAccountsState(list);
    writeCachedAccounts(list);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setPhase("login");
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_OUT") {
        clearTokens();
        clearLocalCaches();
        setAccountsState([]);
        setPhase("login");
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const reloadAccounts = useCallback(async () => {
    setAccounts(await fetchAccounts());
  }, [setAccounts]);

  const refreshTokens = useCallback(async () => {
    const { errors } = await loadTokens();
    setTokenErrors(errors);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
        setPhase("mfa");
        return;
      }
      const cached = readCachedAccounts();
      if (cached && cached.length) {
        // Sofort anzeigen, im Hintergrund aktualisieren
        setPhase("ready");
        void Promise.all([refreshTokens(), reloadAccounts()]).catch(() => undefined);
      } else {
        // Erster Start: Besitzer-Prüfung abwarten
        setPhase("loading");
        await refreshTokens();
        await reloadAccounts();
        setPhase("ready");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [refreshTokens, reloadAccounts]);

  const userId = session?.user.id;
  useEffect(() => {
    if (userId) void start();
  }, [userId, start]);

  if (phase === "loading") return <Splash />;
  if (phase === "login" || !session) return <LoginView />;
  if (phase === "mfa") return <MfaView onDone={start} />;
  if (phase === "error") {
    return (
      <div className="auth">
        <div className="auth-card glass">
          <h1>Hoppla</h1>
          <p className="sub">{error}</p>
          <button className="btn primary" onClick={start}>
            Erneut versuchen
          </button>
          <button className="btn ghost" onClick={() => supabase.auth.signOut()}>
            Abmelden
          </button>
        </div>
      </div>
    );
  }

  const active = route.name === "einrichtung" ? "mehr" : route.name;
  const activeIndex = Math.max(0, TABS.findIndex((t) => t.name === active));

  return (
    <div className="app">
      <main className="main">
        {tokenErrors.length > 0 && route.name !== "konten" && (
          <button className="banner warn pressable" onClick={() => navigate("konten")}>
            <Icon name="alert" size={18} />
            <span>
              {tokenErrors.length === 1 ? "1 Konto ist" : `${tokenErrors.length} Konten sind`} nicht erreichbar –
              antippen
            </span>
          </button>
        )}
        <Suspense fallback={<LineSkeleton />}>
          {route.name === "drive" && <DriveView accounts={accounts} />}
          {route.name === "konten" && (
            <KontenView
              accounts={accounts}
              params={route.params}
              reload={async () => {
                await refreshTokens();
                await reloadAccounts();
              }}
            />
          )}
          {route.name === "protokoll" && <ProtokollView />}
          {route.name === "mehr" && <MehrView session={session} accounts={accounts} />}
          {route.name === "einrichtung" && <EinrichtungView accounts={accounts} reload={reloadAccounts} />}
        </Suspense>
      </main>
      <nav className="tabbar glass">
        <span className="tab-indicator" style={{ transform: `translateX(${activeIndex * 100}%)` }} />
        {TABS.map((t) => (
          <button key={t.name} className={`tab ${active === t.name ? "active" : ""}`} onClick={() => navigate(t.name)}>
            <Icon name={t.icon} size={21} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
