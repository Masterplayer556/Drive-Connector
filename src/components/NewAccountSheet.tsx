// Assistent „Neues Google-Konto“: Google erlaubt kein automatisches Erstellen von Konten – darum bereitet
// die App alles vor (Daten einmal eingeben, Gmail-Adresse vorschlagen), öffnet die Google-Registrierung
// mit Kopier-Knöpfen in der Reihenfolge, in der Google fragt, und verbindet das neue Konto danach gleich
// mit dem gewählten Bereich.
import { useEffect, useState } from "react";
import { AREA_LABEL, ROLES } from "../lib/areas";
import { PENDING_KEY, splitBirthday, suggestUsername, usernameError } from "../lib/newaccount";
import type { Account, Role } from "../lib/types";
import Icon from "./Icon";
import Segmented from "./Segmented";
import { useUI } from "./ui";

const KEY = "drivepool.newaccount";
interface Draft {
  first: string;
  last: string;
  birthday: string;
  gender: string;
  role: Role;
}

const GENDERS = ["Weiblich", "Männlich", "Keine Angabe"];

function loadDraft(): Draft {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (d && typeof d === "object") return { first: "", last: "", birthday: "", gender: GENDERS[2], role: "schule", ...d };
  } catch {
    /* ignorieren */
  }
  return { first: "", last: "", birthday: "", gender: GENDERS[2], role: "schule" };
}

export default function NewAccountSheet({
  accounts,
  onConnect,
  onClose,
}: {
  accounts: Account[];
  /** Google-Login zum Verbinden starten */
  onConnect: () => void;
  onClose: () => void;
}) {
  const ui = useUI();
  const [d, setD] = useState<Draft>(loadDraft);
  const [user, setUser] = useState(() => suggestUsername(accounts.map((a) => a.email)));
  const [step, setStep] = useState<1 | 2 | 3>(() => (loadDraft().first ? 2 : 1));

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
    } catch {
      /* ignorieren */
    }
  }, [d]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const bday = splitBirthday(d.birthday);
  const userErr = usernameError(user);
  const email = `${user.trim().toLowerCase()}@gmail.com`;

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      ui.toast(`${label} kopiert`, "ok");
    } catch {
      ui.toast("Kopieren nicht möglich", "error");
    }
  };

  const Row = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
    <div className="newacc-row">
      <div style={{ minWidth: 0 }}>
        <div className="faint small">{label}</div>
        <div className="ellipsis" style={{ fontWeight: 600 }}>
          {value || "–"}
        </div>
        {hint && <div className="faint small">{hint}</div>}
      </div>
      {value && (
        <button className="btn small" onClick={() => void copy(label, value)} aria-label={`${label} kopieren`}>
          <Icon name="copy" size={16} />
        </button>
      )}
    </div>
  );

  const connect = () => {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify({ email, role: d.role }));
    } catch {
      /* ignorieren */
    }
    onConnect();
  };

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div style={{ minWidth: 0 }}>
            <div className="muted small">Schritt {step} von 3</div>
            <h2>Neues Google-Konto</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Schliessen">
            <Icon name="x" />
          </button>
        </div>
        <div className="sheet-body">
          {step === 1 && (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                setStep(2);
              }}
            >
              <p className="muted small" style={{ margin: 0 }}>
                Einmal eingeben – wird auf diesem Gerät gemerkt und beim nächsten Konto wieder verwendet.
              </p>
              <input className="input" placeholder="Vorname" value={d.first} onChange={(e) => set("first", e.target.value)} autoComplete="given-name" />
              <input className="input" placeholder="Nachname (optional)" value={d.last} onChange={(e) => set("last", e.target.value)} autoComplete="family-name" />
              <label className="stack" style={{ gap: 4 }}>
                <span className="faint small">Geburtsdatum</span>
                <input className="input" type="date" value={d.birthday} onChange={(e) => set("birthday", e.target.value)} />
              </label>
              <label className="stack" style={{ gap: 4 }}>
                <span className="faint small">Geschlecht</span>
                <select className="input" value={d.gender} onChange={(e) => set("gender", e.target.value)}>
                  {GENDERS.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </label>
              <div className="row between">
                <span className="muted small">Bereich des neuen Kontos</span>
                <Segmented
                  value={d.role}
                  onChange={(r) => set("role", r)}
                  options={ROLES.map((r) => ({ value: r, label: AREA_LABEL[r] }))}
                />
              </div>
              <button type="submit" className="btn primary block" disabled={!d.first.trim() || !bday}>
                Weiter
              </button>
            </form>
          )}

          {step === 2 && (
            <div className="stack">
              <label className="stack" style={{ gap: 4 }}>
                <span className="faint small">Gmail-Adresse (Vorschlag – bei „vergeben“ einfach ändern)</span>
                <div className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
                  <input
                    className="input"
                    value={user}
                    onChange={(e) => setUser(e.target.value.replace(/\s/g, ""))}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <span className="muted small">@gmail.com</span>
                </div>
              </label>
              {userErr && <p className="error small">{userErr}</p>}

              <button className="btn primary block" onClick={() => window.open("https://accounts.google.com/signup", "_blank", "noopener")}>
                <Icon name="link" size={18} /> Google-Registrierung öffnen
              </button>
              <p className="faint small" style={{ margin: 0 }}>
                Dort der Reihe nach ausfüllen – mit den Knöpfen kopieren und einfügen:
              </p>
              <div className="card glass newacc-list">
                <Row label="Vorname" value={d.first.trim()} />
                <Row label="Nachname" value={d.last.trim()} />
                <Row label="Tag" value={bday?.day ?? ""} />
                <Row label="Monat" value={bday?.month ?? ""} />
                <Row label="Jahr" value={bday?.year ?? ""} />
                <Row label="Geschlecht" value={d.gender} />
                <Row label="Gmail-Adresse" value={user.trim().toLowerCase()} hint="„Eigene Gmail-Adresse erstellen“ wählen" />
                <div className="newacc-row">
                  <div className="faint small">
                    <strong>Passwort:</strong> Safari schlägt ein starkes Passwort vor → „Starkes Passwort verwenden“. Es wird im
                    iCloud-Schlüsselbund gespeichert und beim Verbinden automatisch vorgeschlagen.
                  </div>
                </div>
                <div className="newacc-row">
                  <div className="faint small">
                    <strong>Telefon / Bestätigung:</strong> Fragt Google nach einer Nummer oder einem Code, musst du das selbst
                    erledigen – das kann die App nicht.
                  </div>
                </div>
              </div>
              <div className="row" style={{ flexWrap: "nowrap", gap: 8 }}>
                <button className="btn ghost" onClick={() => setStep(1)}>
                  Zurück
                </button>
                <button className="btn primary" style={{ flex: 1 }} disabled={!!userErr} onClick={() => setStep(3)}>
                  Konto erstellt – weiter
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="stack">
              <p className="muted" style={{ margin: 0 }}>
                Jetzt <strong>{email}</strong> mit Drive Pool verbinden. Es kommt danach automatisch in den Bereich{" "}
                <strong>{AREA_LABEL[d.role]}</strong>.
              </p>
              <ol className="muted small newacc-steps">
                <li>Bei Google „Anderes Konto verwenden“ und {email} anmelden (Passwort schlägt der Schlüsselbund vor).</li>
                <li>„Google hat diese App nicht überprüft“ → „Erweitert“ → „Weiter zu Drive Pool“.</li>
                <li>Das Drive-Häkchen setzen und „Weiter“.</li>
              </ol>
              <button className="btn primary block" onClick={connect}>
                <Icon name="plus" size={19} /> Jetzt verbinden
              </button>
              <button className="btn ghost block" onClick={() => setStep(2)}>
                Zurück
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
