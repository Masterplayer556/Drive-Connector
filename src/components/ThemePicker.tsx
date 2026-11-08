import { useState } from "react";
import { autoPair, BLEND_MAX, readFolderBlend, readPrefs, resolveTheme, saveFolderBlend, savePrefs, THEMES, type ThemeId, type ThemeInfo, type ThemePrefs } from "../lib/theme";
import Icon from "./Icon";

const nameOf = (id: ThemeId) => THEMES.find((t) => t.id === id)?.name ?? id;

/** Kleine Ansicht der Startseite im jeweiligen Design: Titel, Speicher-Karte mit Ring, Archiv & Privat. */
function ThemePreview({ t }: { t: ThemeInfo }) {
  const p = t.preview;
  const r = p.radius;
  return (
    <div className={`theme-preview tp-${t.id}`} style={{ background: p.bg }}>
      <i style={{ width: 70, height: 70, left: -14, top: -20, background: p.blobs[0] }} />
      <i style={{ width: 60, height: 60, right: -10, top: 0, background: p.blobs[1] }} />
      <i style={{ width: 60, height: 60, left: 40, bottom: -30, background: p.blobs[2] }} />
      {p.overlay && <span className="tp-overlay" style={{ background: p.overlay }} />}
      <span className="tp-title" style={{ background: p.title }} />
      <span className="tp-card" style={{ background: p.card, boxShadow: p.cardShadow, borderRadius: r + 2 }}>
        <span className="tp-ring" style={{ background: p.ring }} />
        <span className="tp-lines">
          <span style={{ background: p.line, width: "70%" }} />
          <span style={{ background: p.line, width: "45%", opacity: 0.7 }} />
        </span>
      </span>
      <span className="tp-areas">
        {p.areas.map((a, i) => (
          <span key={i} style={{ background: a, boxShadow: p.areaShadow, borderRadius: r }} />
        ))}
      </span>
    </div>
  );
}

/** Design-Auswahl mit Live-Vorschau-Kacheln und „Automatisch hell/dunkel“. */
export default function ThemePicker() {
  const [prefs, setPrefs] = useState<ThemePrefs>(readPrefs);
  const [blend, setBlend] = useState(readFolderBlend);
  const changeBlend = (v: number) => {
    setBlend(v);
    saveFolderBlend(v);
  };

  const update = (next: ThemePrefs) => {
    setPrefs(next);
    savePrefs(next);
  };
  // Mit „Automatisch hell/dunkel“ würde ein angetipptes Design oft gar nicht erscheinen (iPhone hell → immer
  // Polar). Darum: Design antippen = genau dieses zeigen, Automatik aus – ausser es passt gerade zur Automatik.
  const choose = (theme: ThemeId) => {
    const next = { ...prefs, theme };
    update(next.auto && resolveTheme(next) !== theme ? { ...next, auto: false } : next);
  };

  return (
    <>
      <div className="theme-grid stagger">
        {THEMES.map((t, i) => {
          const on = prefs.theme === t.id;
          return (
            <button
              key={t.id}
              className={`theme-card ${on ? "on" : ""}`}
              style={{ ["--i" as string]: i }}
              onClick={() => choose(t.id as ThemeId)}
            >
              <ThemePreview t={t} />
              <div className="theme-meta">
                <strong>{t.name}</strong>
                <span>{t.description}</span>
              </div>
              {on && (
                <span className="theme-check">
                  <Icon name="check" size={14} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <label className="switch-row glass" style={{ margin: "12px 18px 0" }}>
        <span>
          <strong>Automatisch hell/dunkel</strong>
          <div className="muted small">
            Hell am iPhone → {nameOf(autoPair(prefs.theme).light)}, dunkel → {nameOf(autoPair(prefs.theme).dark)}
          </div>
        </span>
        <span className="switch">
          <input type="checkbox" checked={prefs.auto} onChange={(e) => update({ ...prefs, auto: e.target.checked })} />
          <span />
        </span>
      </label>

      <div className="slider-row glass" style={{ margin: "12px 18px 0" }}>
        <div className="slider-head">
          <span className="blend-preview" aria-hidden="true">
            {[200, 330].map((h) => (
              <span key={h} className="folder-icon" style={{ ["--h" as string]: h }}>
                <Icon name="folder" size={15} />
              </span>
            ))}
          </span>
          <span>
            <strong>Ordnerfarben-Verlauf</strong>
            <div className="muted small">{blend === 0 ? "Aus – einfarbig" : `Übergang in einen zweiten Farbton (${blend}°)`}</div>
          </span>
          <span className="switch">
            <input type="checkbox" checked={blend > 0} onChange={(e) => changeBlend(e.target.checked ? 45 : 0)} aria-label="Verlauf ein/aus" />
            <span />
          </span>
        </div>
        <input
          type="range"
          className="slider"
          min={0}
          max={BLEND_MAX}
          step={5}
          value={blend}
          style={{ ["--fill" as string]: `${(blend / BLEND_MAX) * 100}%` }}
          onChange={(e) => changeBlend(Number(e.target.value))}
          aria-label="Stärke des Ordnerfarben-Verlaufs"
        />
      </div>
    </>
  );
}
