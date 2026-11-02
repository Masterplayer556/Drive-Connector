import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import Icon, { type IconName } from "../components/Icon";
import ThemePicker from "../components/ThemePicker";
import Topbar from "../components/Topbar";
import { useUI } from "../components/ui";
import { invalidateAll } from "../lib/cache";
import { syncAccounts } from "../lib/db";
import { navigate } from "../lib/route";
import { supabase } from "../lib/supabase";
import type { Account } from "../lib/types";

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

export default function MehrView({ session, accounts }: { session: Session; accounts: Account[] }) {
  const ui = useUI();
  const [hasMfa, setHasMfa] = useState<boolean | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<Enroll | null>(null);
  const [code, setCode] = useState("");
  const [syncing, setSyncing] = useState(false);

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
      <ThemePicker />

      <div className="section-title">
        <span>Sicherheit</span>
      </div>
      <div className="list glass enter" style={{ animationDelay: "60ms" }}>
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

      <div className="list glass enter" style={{ animationDelay: "120ms" }}>
        <Item icon="logout" bg="linear-gradient(135deg,#fb7185,#e11d48)" title="Abmelden" danger onClick={logout} />
      </div>

      <p className="faint small" style={{ textAlign: "center", marginTop: 18 }}>
        Drive Pool
      </p>
    </div>
  );
}
