import type { Session } from "@supabase/supabase-js";
import { lazy, Suspense, useEffect, useState } from "react";
import Icon, { type IconName } from "../components/Icon";
import { ThemePreview } from "../components/ThemePicker";
import { disableLock, enableLock, lockEnabled, lockError, lockSupported } from "../lib/lock";
import Topbar from "../components/Topbar";
import { useUI } from "../components/ui";
import { invalidateAll } from "../lib/cache";
import { syncAccounts } from "../lib/db";
import { navigate } from "../lib/route";
import { supabase } from "../lib/supabase";
import type { Account } from "../lib/types";
import { THEMES } from "../lib/theme";
import { lastSealReport, sealSummary } from "../lib/health";
import { buildInventoryZip, saveFile } from "../lib/inventory";
import { useThemeId } from "../lib/useTheme";

const AiSettings = lazy(() => import("../ai/AiSettings")); // KI-SUCHE
const AiWipeSheet = lazy(() => import("../ai/AiWipeSheet")); // KI-SUCHE

interface Enroll {
  factorId: string;
  qr: string;
  secret: string;
}

function Item({
  icon,
  bg,
  title,
  sub,
  onClick,
  danger,
  right,
}: {
  icon: IconName;
  bg: string;
  title: string;
  sub?: string;
  onClick?: () => void;
  danger?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <button className={`list-item ${danger ? "danger" : ""}`} onClick={onClick}>
      <span className="li-icon" style={{ background: bg }}>
        <Icon name={icon} size={18} />
      </span>
      <span className="li-text">
        {title}
        {sub && <small>{sub}</small>}
      </span>
      {right ?? (onClick && <Icon name="chevronRight" size={18} className="faint" />)}
    </button>
  );
}

/** Kachel zur Design-Seite: zeigt das aktive Design als Mini-Startseite. */
function DesignTile() {
  const id = useThemeId();
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0];
  return (
    <button className="design-tile glass enter" onClick={() => navigate("design")}>
      <span className="design-tile-preview">
        <ThemePreview t={t} />
      </span>
      <span className="design-tile-text">
        <strong>{t.name}</strong>
        <small>{THEMES.length} Designs · Hell & Dunkel · Ordnerfarben · Bewegung</small>
      </span>
      <Icon name="chevronRight" size={18} className="faint" />
    </button>
  );
}

/** Face-ID-Sperre (#12) ein/aus. */
function FaceIdItem({ email }: { email: string }) {
  const ui = useUI();
  const [on, setOn] = useState(lockEnabled);
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    void lockSupported().then(setSupported);
  }, []);

  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (busy) return;
    if (on) {
      disableLock();
      setOn(false);
      ui.toast("Face-ID-Sperre aus", "info");
      return;
    }
    if (supported === false) {
      ui.toast("Face ID ist hier nicht verfügbar – App über den Home-Bildschirm öffnen und Face ID für Safari erlauben", "error");
      return;
    }
    setBusy(true);
    try {
      await enableLock(email);
      setOn(true);
      ui.toast("Face-ID-Sperre aktiv – beim Öffnen genügt ein Blick", "ok");
    } catch (e) {
      ui.toast(lockError(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="list-item" style={{ cursor: "pointer" }}>
      <span className="li-icon" style={{ background: "linear-gradient(135deg,#60a5fa,#8b5cf6)" }}>
        <Icon name="faceId" size={18} />
      </span>
      <span className="li-text">
        Face-ID-Sperre
        <small>
          {supported === false ? "Auf diesem Gerät nicht verfügbar" : on ? "Aktiv – nach 5 Minuten im Hintergrund wieder gesperrt" : "Statt Passwort beim Öffnen"}
        </small>
      </span>
      {busy ? (
        <span className="spinner" />
      ) : (
        <span className="switch">
          <input type="checkbox" checked={on} onChange={toggle} />
          <span />
        </span>
      )}
    </label>
  );
}

export default function MehrView({ session, accounts }: { session: Session; accounts: Account[] }) {
  const ui = useUI();
  const [hasMfa, setHasMfa] = useState<boolean | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<Enroll | null>(null);
  const [code, setCode] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [aiWipe, setAiWipe] = useState(false); // KI-SUCHE
  const [seal] = useState(lastSealReport);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportFile, setExportFile] = useState<File | null>(null);

  // Notfall-Export: ZIP mit allen Dateien, Konten und Pfaden. Zweiter Tipper sichert es –
  // das iPhone öffnet das Teilen-Menü nur direkt nach einem Tippen.
  const exportInventory = async () => {
    if (exportFile) {
      try {
        await saveFile(exportFile);
        setExportFile(null);
      } catch (e) {
        ui.toast(e instanceof Error ? e.message : String(e), "error");
      }
      return;
    }
    setExporting("Liste wird erstellt …");
    try {
      setExportFile(await buildInventoryZip(accounts, (n) => setExporting(`${n.toLocaleString("de-CH")} Einträge gelesen …`)));
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setExporting(null);
    }
  };

  const loadFactors = async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) return ui.toast(error.message, "error");
    const f = data.totp.find((x) => x.status === "verified");
    setHasMfa(!!f);
    setFactorId(f?.id ?? null);
  };

  useEffect(() => {
    void loadFactors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startEnroll = async () => {
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of list?.all ?? []) {
      if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Drive Pool" });
    if (error) return ui.toast(error.message, "error");
    setEnroll({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };

  const confirmEnroll = async () => {
    if (!enroll) return;
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll.factorId, code: code.trim() });
    if (error) return ui.toast(error.message, "error");
    setEnroll(null);
    setCode("");
    ui.toast("Zwei-Faktor-Schutz ist aktiv", "ok");
    await loadFactors();
  };

  const removeMfa = async () => {
    if (!factorId) return;
    const ok = await ui.confirm({
      title: "2FA entfernen?",
      message: "Danach reicht wieder nur das Passwort zum Anmelden.",
      confirmLabel: "Entfernen",
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) return ui.toast(error.message, "error");
    ui.toast("Zwei-Faktor-Schutz entfernt", "ok");
    await loadFactors();
  };

  const fullSync = async () => {
    const ok = await ui.confirm({
      title: "Alles neu einlesen?",
      message: "Alle Konten werden komplett neu eingelesen. Das kann ein paar Minuten dauern.",
      confirmLabel: "Neu einlesen",
    });
    if (!ok) return;
    setSyncing(true);
    try {
      const r = await syncAccounts(undefined, true);
      const failed = r.filter((x) => x.error);
      if (failed.length) ui.toast(failed.map((f) => `${f.email}: ${f.error}`).join("\n"), "error");
      else ui.toast("Alle Konten neu eingelesen", "ok");
      invalidateAll();
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSyncing(false);
    }
  };

  const logout = async () => {
    const ok = await ui.confirm({ title: "Abmelden?", confirmLabel: "Abmelden", danger: true });
    if (ok) await supabase.auth.signOut();
  };

  return (
    <div className="view page-fade">
      <Topbar eyebrow={session.user.email} title="Mehr" />

      <div className="list glass enter">
        <Item
          icon="compass"
          bg="linear-gradient(135deg,#a78bfa,#ec4899)"
          title="Einrichtung"
          sub="Ordner Archiv oder Privat zuordnen"
          onClick={() => navigate("einrichtung")}
        />
        <Item
          icon="chart"
          bg="linear-gradient(135deg,#8b5cf6,#3b82f6)"
          title="Statistik"
          sub="Uploads, Speicherverlauf, grösste Ordner"
          onClick={() => navigate("statistik")}
        />
        <Item
          icon="archive"
          bg="linear-gradient(135deg,#f59e0b,#ec4899)"
          title="Regal & Rebalancing"
          sub="Konten als Regal, Vorschläge, Ordner sperren"
          onClick={() => navigate("regal")}
        />
        <Item
          icon="copy"
          bg="linear-gradient(135deg,#22d3ee,#3b82f6)"
          title="Duplikate"
          sub="Doppelte Fotos finden und aufräumen"
          onClick={() => navigate("duplikate")}
        />
        <Item
          icon="sparkles"
          bg="linear-gradient(135deg,#34d399,#0ea5e9)"
          title="Platz sparen"
          sub="Grösste Dateien, Dateitypen, alte Screenshots"
          onClick={() => navigate("platz")}
        />
        <Item
          icon="share"
          bg="linear-gradient(135deg,#a78bfa,#6366f1)"
          title="Teilen-Menü (Kurzbefehl)"
          sub="Aus Fotos & Dateien direkt in Drive Pool sichern"
          onClick={() => navigate("teilen")}
        />
        <Item
          icon="trash"
          bg="linear-gradient(135deg,#fb7185,#f97316)"
          title="Papierkorb"
          sub="Wiederherstellen, endgültig löschen, automatisch leeren"
          onClick={() => navigate("papierkorb")}
        />
        <Item
          icon="heart"
          bg="linear-gradient(135deg,#fb7185,#ec4899)"
          title="Favoriten"
          onClick={() => navigate("favoriten")}
        />
        <Item
          icon="link"
          bg="linear-gradient(135deg,#34d399,#0d9488)"
          title="Geteilte Links"
          sub="Anzeigen, kopieren, entfernen"
          onClick={() => navigate("links")}
        />
        <Item
          icon="refresh"
          bg="linear-gradient(135deg,#60a5fa,#6366f1)"
          title="Komplett neu einlesen"
          sub={`${accounts.length} Konten`}
          onClick={syncing ? undefined : fullSync}
          right={syncing ? <span className="spinner" /> : undefined}
        />
      </div>

      <div className="section-title">
        <span>Design</span>
      </div>
      <DesignTile />

      {/* KI-SUCHE */}
      <div className="section-title">
        <span>Suche</span>
      </div>
      <Suspense fallback={null}>
        <AiSettings accounts={accounts} />
      </Suspense>

      <div className="section-title">
        <span>Sicherheit</span>
      </div>
      <div className="list glass enter" style={{ animationDelay: "60ms" }}>
        <Item
          icon="shield"
          bg={seal && seal.total ? "linear-gradient(135deg,#fb7185,#e11d48)" : "linear-gradient(135deg,#4ade80,#0d9488)"}
          title="Abschottung (Privat & Claude)"
          sub={seal ? sealSummary(seal).replace("Abschottung geprüft: ", "") : "Wöchentliche Prüfung – noch nicht gelaufen"}
          onClick={() => navigate("pruefung")}
        />
        <Item
          icon="download"
          bg="linear-gradient(135deg,#94a3b8,#475569)"
          title="Notfall-Export"
          sub={exporting ?? (exportFile ? "Bereit – antippen zum Sichern" : "Liste aller Dateien mit Konto und Pfad (ZIP)")}
          onClick={exporting ? undefined : exportInventory}
          right={exporting ? <span className="spinner" /> : undefined}
        />
        <FaceIdItem email={session.user.email ?? "Drive Pool"} />
        {hasMfa === null ? (
          <Item icon="shield" bg="linear-gradient(135deg,#4ade80,#16a34a)" title="Zwei-Faktor-Schutz" sub="Lädt …" />
        ) : hasMfa ? (
          <Item
            icon="shield"
            bg="linear-gradient(135deg,#4ade80,#16a34a)"
            title="Zwei-Faktor-Schutz"
            sub="Aktiv – antippen zum Entfernen"
            onClick={removeMfa}
          />
        ) : enroll ? (
          <div className="stack" style={{ padding: 16 }}>
            <strong>2FA einrichten</strong>
            <span className="muted small">
              Scanne den QR-Code mit der Passwörter-App des iPhones oder einer Authenticator-App.
            </span>
            <img className="qr" src={enroll.qr} alt="QR-Code" />
            <code className="secret">{enroll.secret}</code>
            <input
              className="input code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <button className="btn primary" disabled={code.length !== 6} onClick={confirmEnroll}>
              Bestätigen
            </button>
          </div>
        ) : (
          <Item
            icon="shield"
            bg="linear-gradient(135deg,#fbbf24,#f97316)"
            title="Zwei-Faktor-Schutz einrichten"
            sub="Empfohlen – die App hat Zugriff auf alle Drives"
            onClick={startEnroll}
          />
        )}
      </div>

      {/* KI-SUCHE: KI-Daten löschen – eigenes Fenster, nur mit 2FA-Code */}
      <div className="list glass enter" style={{ animationDelay: "90ms" }}>
        <Item
          icon="sparkles"
          bg="linear-gradient(135deg,#f472b6,#e11d48)"
          title="KI-Daten löschen"
          sub={hasMfa ? "Modell, Index und Namen von diesem Gerät – mit 2FA-Code" : "Braucht den Zwei-Faktor-Schutz"}
          onClick={() => setAiWipe(true)}
        />
      </div>
      {aiWipe && (
        <Suspense fallback={null}>
          <AiWipeSheet factorId={factorId} onClose={() => setAiWipe(false)} />
        </Suspense>
      )}

      <div className="list glass enter" style={{ animationDelay: "120ms" }}>
        <Item icon="logout" bg="linear-gradient(135deg,#fb7185,#e11d48)" title="Abmelden" danger onClick={logout} />
      </div>

      <p className="faint small" style={{ textAlign: "center", marginTop: 18 }}>
        Drive Pool
      </p>
    </div>
  );
}
