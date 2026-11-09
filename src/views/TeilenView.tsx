import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import Topbar from "../components/Topbar";
import { useUI } from "../components/ui";
import { formatDateTime } from "../lib/format";
import { navigate } from "../lib/route";
import { supabase } from "../lib/supabase";

interface Token {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/share-upload`;
const FOLDERS = ["Eingang", "Archiv/Eingang", "Privat/Eingang", "Claude/Eingang"];

async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newKey(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return "dp_" + btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Teilen-Menü über einen iOS-Kurzbefehl: Web-Apps können sich nicht selbst ins Teilen-Menü eintragen,
 * ein Kurzbefehl schon. Er schickt die Datei mit einem persönlichen Schlüssel an Drive Pool.
 */
export default function TeilenView() {
  const ui = useUI();
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [folder, setFolder] = useState(FOLDERS[0]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data, error } = await supabase.from("share_tokens").select("id,label,created_at,last_used_at").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    setTokens((data ?? []) as Token[]);
  };
  useEffect(() => {
    load().catch((e) => ui.toast(e instanceof Error ? e.message : String(e), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    setBusy(true);
    try {
      const { data: s } = await supabase.auth.getSession();
      const uid = s.session?.user.id;
      if (!uid) throw new Error("Nicht angemeldet");
      const key = newKey();
      const { error } = await supabase.from("share_tokens").insert({ owner_id: uid, token_hash: await sha256Hex(key), label: "Kurzbefehl iPhone" });
      if (error) throw new Error(error.message);
      setFresh(key);
      await load();
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t: Token) => {
    const ok = await ui.confirm({
      title: "Schlüssel löschen?",
      message: "Kurzbefehle mit diesem Schlüssel funktionieren danach nicht mehr.",
      confirmLabel: "Löschen",
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("share_tokens").delete().eq("id", t.id);
    if (error) return ui.toast(error.message, "error");
    await load();
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      ui.toast(`${what} kopiert`, "ok");
    } catch {
      ui.toast("Kopieren nicht möglich – bitte von Hand markieren", "error");
    }
  };

  const url = `${ENDPOINT}?folder=${encodeURIComponent(folder)}`;

  return (
    <div className="view page-forward">
      <Topbar
        eyebrow="Fotos & Dateien → Drive Pool"
        title="Teilen-Menü"
        left={
          <button className="icon-btn" onClick={() => navigate("mehr")} aria-label="Zurück">
            <Icon name="chevronLeft" />
          </button>
        }
      />
      <p className="muted pad small">
        Eine Web-App kann sich auf dem iPhone nicht selbst ins Teilen-Menü eintragen – ein <strong>Kurzbefehl</strong> schon.
        Einmal einrichten, dann erscheint „In Drive Pool sichern“ beim Teilen in Fotos, Dateien, Safari … Die Datei landet
        nach denselben Regeln wie in der App im passenden Konto (Privat und Claude bleiben abgeschottet).
      </p>

      <div className="section-title">
        <span>1. Schlüssel</span>
      </div>
      {fresh ? (
        <section className="card glass stack">
          <strong>Neuer Schlüssel – nur jetzt sichtbar</strong>
          <code className="secret share-key">{fresh}</code>
          <button className="btn primary" onClick={() => copy(fresh, "Schlüssel")}>
            <Icon name="copy" size={17} /> Schlüssel kopieren
          </button>
          <span className="faint small">Gespeichert wird nur eine Prüfsumme. Geht er verloren, einfach einen neuen erstellen.</span>
        </section>
      ) : (
        <div className="stack pad">
          <button className="btn primary block" disabled={busy} onClick={create}>
            {busy ? <span className="spinner" /> : <Icon name="plus" size={18} />} Schlüssel erstellen
          </button>
        </div>
      )}
      {!!tokens?.length && (
        <div className="list glass">
          {tokens.map((t) => (
            <div key={t.id} className="list-item">
              <span className="li-icon" style={{ background: "linear-gradient(135deg,#a78bfa,#6366f1)" }}>
                <Icon name="link" size={17} />
              </span>
              <span className="li-text">
                {t.label}
                <small>
                  Erstellt {formatDateTime(t.created_at)} · {t.last_used_at ? `zuletzt ${formatDateTime(t.last_used_at)}` : "noch nie benutzt"}
                </small>
              </span>
              <button className="icon-btn" onClick={() => remove(t)} aria-label="Schlüssel löschen">
                <Icon name="trash" size={17} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="section-title">
        <span>2. Zielordner &amp; Adresse</span>
      </div>
      <div className="chips pad" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {FOLDERS.map((f) => (
          <button key={f} className={`chip ${folder === f ? "on" : ""}`} onClick={() => setFolder(f)}>
            {f}
          </button>
        ))}
      </div>
      <section className="card glass stack">
        <code className="secret share-key">{url}</code>
        <button className="btn" onClick={() => copy(url, "Adresse")}>
          <Icon name="copy" size={17} /> Adresse kopieren
        </button>
      </section>

      <div className="section-title">
        <span>3. Kurzbefehl bauen</span>
      </div>
      <ol className="card glass share-steps">
        <li>
          App <strong>Kurzbefehle</strong> → <strong>+</strong> → Name „In Drive Pool sichern“.
        </li>
        <li>
          Oben auf <strong>ⓘ</strong> → <strong>Im Share-Sheet anzeigen</strong> einschalten (Typen: Bilder, Medien, Dateien).
        </li>
        <li>
          Aktion <strong>Wiederholen mit jedem</strong> – Eingabe: <em>Kurzbefehleingabe</em>.
        </li>
        <li>
          Darin <strong>Inhalte von URL abrufen</strong>: URL = kopierte Adresse, Methode <strong>POST</strong>, Anfragetext{" "}
          <strong>Datei</strong> = <em>Wiederholungsobjekt</em>.
        </li>
        <li>
          Unter <strong>Header</strong> zwei Einträge: <code>x-drive-pool-key</code> = dein Schlüssel und <code>x-file-name</code> ={" "}
          <em>Wiederholungsobjekt → Name</em>.
        </li>
        <li>
          Nach der Schleife: <strong>Mitteilung anzeigen</strong> „In Drive Pool gesichert“.
        </li>
      </ol>
      <p className="faint small pad" style={{ marginTop: 10 }}>
        Mehrere Zielordner? Einfach den Kurzbefehl duplizieren und die Adresse mit einem anderen Ordner kopieren – oder vor
        der Schleife <strong>Aus Menü auswählen</strong> einbauen. Grenze pro Datei: 150 MB (grössere in der App hochladen).
      </p>
    </div>
  );
}
