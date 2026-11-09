import type { Session } from "@supabase/supabase-js";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import Icon, { type IconName } from "./components/Icon";
import { LineSkeleton } from "./components/Skeleton";
import Splash from "./components/Splash";
import UndoBar from "./components/UndoBar";
import { UIProvider, useUI } from "./components/ui";
import { autoPurgeIfDue } from "./lib/trash";
import { sealCheckIfDue } from "./lib/health";
import LockScreen from "./components/LockScreen";
import { lockEnabled, watchRelock } from "./lib/lock";
import { clearLocalCaches, readCachedAccounts, writeCachedAccounts } from "./lib/cache";
import { fetchAccounts } from "./lib/db";
import { startHousekeeping } from "./lib/housekeeping";
import { clearTokens, loadTokens } from "./lib/google";
import { navigate, useRoute, type RouteName } from "./lib/route";
import { supabase } from "./lib/supabase";
import type { Account } from "./lib/types";
import DriveView from "./views/DriveView";
import LoginView from "./views/LoginView";
import MfaView from "./views/MfaView";
import { useAiEnabled } from "./ai/flag"; // KI-SUCHE

const KontenView = lazy(() => import("./views/KontenView"));
const ProtokollView = lazy(() => import("./views/ProtokollView"));
const MehrView = lazy(() => import("./views/MehrView"));
const EinrichtungView = lazy(() => import("./views/EinrichtungView"));
const DuplikateView = lazy(() => import("./views/DuplikateView"));
const PapierkorbView = lazy(() => import("./views/PapierkorbView"));
const FavoritenView = lazy(() => import("./views/FavoritenView"));
const StatistikView = lazy(() => import("./views/StatistikView"));
const RegalView = lazy(() => import("./views/RegalView"));
const LinksView = lazy(() => import("./views/LinksView"));
const DesignView = lazy(() => import("./views/DesignView"));
const AbschottungView = lazy(() => import("./views/AbschottungView"));
const PlatzView = lazy(() => import("./views/PlatzView"));
const TeilenView = lazy(() => import("./views/TeilenView"));
const AiIndexer = lazy(() => import("./ai/AiIndexer")); // KI-SUCHE

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
  const { toast } = useUI();
  const [session, setSession] = useState<Session | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccountsState] = useState<Account[]>(() => readCachedAccounts() ?? []);
  const [tokenErrors, setTokenErrors] = useState<{ email: string; error: string }[]>([]);
  const route = useRoute();
  const [locked, setLocked] = useState(lockEnabled);
  const ai = useAiEnabled(); // KI-SUCHE

  useEffect(() => watchRelock(() => setLocked(true)), []);

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
    const list = await fetchAccounts();
    setAccounts(list);
    return list;
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
        void Promise.all([refreshTokens(), reloadAccounts()])
          .then(([, list]) => autoPurgeIfDue(list))
          .then((r) => r?.count && toast(`Papierkorb: ${r.count} alte Einträge gelöscht`, "info"))
          .catch(() => undefined)
          // Einmal pro Woche: liegt etwas im falschen Bereich (Privat / Claude)?
          .then(() => sealCheckIfDue())
          .then((r) => r?.total && toast(`${r.total} Einträge liegen im falschen Bereich – Mehr → Abschottung`, "error"))
          .catch(() => undefined);
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

  useEffect(() => {
    if (phase === "ready") startHousekeeping();
  }, [phase]);

  // KI-SUCHE: Hintergrund-Index erst nach dem Start – er liest zehntausende Einträge und würde sonst
  // mit dem Laden der Ordner um Netz und Rechenzeit kämpfen (Start dauerte so mehrere Sekunden)
  const [aiLater, setAiLater] = useState(false);
  useEffect(() => {
    if (phase !== "ready" || aiLater) return;
    const t = setTimeout(() => setAiLater(true), 8_000);
    return () => clearTimeout(t);
  }, [phase, aiLater]);

  if (locked && session && phase !== "login") return <LockScreen onUnlock={() => setLocked(false)} />;
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

  const active = ["einrichtung", "duplikate", "papierkorb", "favoriten", "statistik", "links", "regal", "design", "pruefung", "platz", "teilen"].includes(route.name)
    ? "mehr"
    : route.name;
  const activeIndex = Math.max(0, TABS.findIndex((t) => t.name === active));

  const current = session;
  return <Chrome activeIndex={activeIndex} active={active}>{body()}</Chrome>;

  function body() {
    return (
      <>
        {tokenErrors.length > 0 && route.name !== "konten" && (
          <button className="banner warn pressable" onClick={() => navigate("konten")}>
            <Icon name="alert" size={18} />
            <span>
              {tokenErrors.length === 1 ? "1 Konto ist" : `${tokenErrors.length} Konten sind`} nicht erreichbar –
              antippen
            </span>
          </button>
        )}
        {/* KI-SUCHE: Hintergrund-Index, nur wenn eingeschaltet und entsperrt */}
        {ai && aiLater && (
          <ErrorBoundary silent>
            <Suspense fallback={null}>
              <AiIndexer />
            </Suspense>
          </ErrorBoundary>
        )}
        {/* key: beim Wechsel der Ansicht ist ein Fehler der vorherigen wieder weg */}
        <ErrorBoundary key={route.name}>
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
            {route.name === "mehr" && <MehrView session={current} accounts={accounts} />}
            {route.name === "einrichtung" && (
              <EinrichtungView
                accounts={accounts}
                reload={async () => {
                  await reloadAccounts();
                }}
              />
            )}
            {route.name === "duplikate" && <DuplikateView accounts={accounts} />}
            {route.name === "papierkorb" && <PapierkorbView accounts={accounts} />}
            {route.name === "favoriten" && <FavoritenView accounts={accounts} />}
            {route.name === "statistik" && <StatistikView accounts={accounts} />}
            {route.name === "regal" && <RegalView accounts={accounts} />}
            {route.name === "links" && <LinksView accounts={accounts} />}
            {route.name === "design" && <DesignView />}
            {route.name === "pruefung" && <AbschottungView />}
            {route.name === "platz" && <PlatzView />}
            {route.name === "teilen" && <TeilenView />}
          </Suspense>
        </ErrorBoundary>
      </>
    );
  }
}

/** Rahmen mit Liquid-Glass-Tab-Leiste: schrumpft beim Runterscrollen, Markierung dehnt sich beim Wechseln. */
function Chrome({ activeIndex, active, children }: { activeIndex: number; active: RouteName; children: React.ReactNode }) {
  const [compact, setCompact] = useState(false);
  const [stretch, setStretch] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    let last = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        if (y > 80 && y > last + 6) setCompact(true);
        else if (y < last - 6 || y < 40) setCompact(false);
        last = y;
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setCompact(false);
    setStretch(true);
    const t = setTimeout(() => setStretch(false), 560);
    return () => clearTimeout(t);
  }, [activeIndex]);

  return (
    <div className={`app ${compact ? "compact" : ""}`}>
      <main className="main">{children}</main>
      <UndoBar />
      <nav className={`tabbar glass ${compact ? "compact" : ""}`}>
        <span
          className={`tab-indicator ${stretch ? "stretch" : ""} ${
            activeIndex === 0 ? "edge edge-left" : activeIndex === TABS.length - 1 ? "edge edge-right" : ""
          }`}
          style={{
            // Bewegung über „translate“: so dehnt sich der Tropfen (scale) um seine aktuelle Position
            // statt um den Startplatz – sonst schiesst das Glas bei weiten Sprüngen über die Leiste hinaus
            translate: `${activeIndex * 100}% 0`,
            transitionProperty: "translate",
            transitionTimingFunction:
              activeIndex === 0 || activeIndex === TABS.length - 1 ? "cubic-bezier(0.22, 1, 0.36, 1)" : undefined,
            transformOrigin: activeIndex === 0 ? "left center" : activeIndex === TABS.length - 1 ? "right center" : undefined,
          }}
        />
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
