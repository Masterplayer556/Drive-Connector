import { useState } from "react";
import Icon from "../components/Icon";
import Topbar from "../components/Topbar";
import { useUI } from "../components/ui";
import { AREA_LABEL } from "../lib/areas";
import { formatBytes, formatDateTime } from "../lib/format";
import { lastSealReport, runSealCheck, sealSummary, type SealReport } from "../lib/health";
import { navigate } from "../lib/route";

/** Prüfbericht: liegt in Privat- oder Claude-Konten etwas, das dort nicht hingehört – oder umgekehrt? */
export default function AbschottungView() {
  const ui = useUI();
  const [report, setReport] = useState<SealReport | null>(lastSealReport);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true);
    try {
      const r = await runSealCheck();
      setReport(r);
      ui.toast(r.total ? `${r.total} Einträge im falschen Bereich` : "Alles am richtigen Ort", r.total ? "error" : "ok");
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="view page-forward">
      <Topbar
        eyebrow="Privat & Claude"
        title="Abschottung"
        left={
          <button className="icon-btn" onClick={() => navigate("mehr")} aria-label="Zurück">
            <Icon name="chevronLeft" />
          </button>
        }
      />
      <p className="muted pad small">
        Privat und Claude sind abgeschottet: In ihren Konten darf nur ihr eigener Bereich liegen, und ihre Ordner nur in
        ihren Konten. Die App prüft das einmal pro Woche von selbst und schreibt das Ergebnis ins Protokoll.
      </p>

      <section className={`card glass seal-status ${report ? (report.total ? "bad" : "ok") : ""}`}>
        <span className="seal-icon">
          <Icon name={report && report.total ? "alert" : report ? "checkCircle" : "shield"} size={26} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong>{report ? sealSummary(report).replace("Abschottung geprüft: ", "") : "Noch nicht geprüft"}</strong>
          <div className="muted small">{report ? `Zuletzt geprüft ${formatDateTime(report.at)}` : "Tippe auf „Jetzt prüfen“"}</div>
        </div>
      </section>

      <div className="stack pad">
        <button className="btn primary block" disabled={busy} onClick={check}>
          {busy ? <span className="spinner" /> : <Icon name="shield" size={18} />} Jetzt prüfen
        </button>
      </div>

      {report && report.items.length > 0 && (
        <>
          <div className="section-title">
            <span>Im falschen Bereich</span>
            <span className="faint">{report.total}</span>
          </div>
          <div className="list glass">
            {report.items.map((v) => (
              <div key={`${v.account_id}|${v.path}`} className="list-item">
                <span className="li-icon" style={{ background: "linear-gradient(135deg,#fb7185,#e11d48)" }}>
                  <Icon name={v.is_folder ? "folder" : "image"} size={17} />
                </span>
                <span className="li-text">
                  <span className="ellipsis" style={{ display: "block" }}>
                    {v.path}
                  </span>
                  <small>
                    in {AREA_LABEL[v.role]}-Konto {v.email}
                    {v.size ? ` · ${formatBytes(v.size)}` : ""}
                  </small>
                </span>
              </div>
            ))}
          </div>
          <p className="faint small pad" style={{ marginTop: 10 }}>
            Ordner mit Bereich (Archiv/, Privat/, Claude/) holt das Rebalancing ins richtige Konto („Einordnen“). Alles
            andere ordnest du unter Mehr → Einrichtung zu.
          </p>
          <div className="row pad">
            <button className="btn small" onClick={() => navigate("regal")}>
              <Icon name="archive" size={16} /> Rebalancing
            </button>
            <button className="btn small" onClick={() => navigate("einrichtung")}>
              <Icon name="compass" size={16} /> Einrichtung
            </button>
          </div>
        </>
      )}
    </div>
  );
}
