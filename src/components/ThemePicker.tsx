import { useState } from "react";
import { BLEND_MAX, readFolderBlend, readPrefs, resolveTheme, saveFolderBlend, savePrefs, THEMES, type ThemeId, type ThemePrefs } from "../lib/theme";
import Icon from "./Icon";

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
              <div className="theme-preview" style={{ background: t.preview.bg }}>
                <i style={{ width: 70, height: 70, left: -14, top: -20, background: t.preview.blobs[0] }} />
                <i style={{ width: 60, height: 60, right: -10, top: 0, background: t.preview.blobs[1] }} />
                <i style={{ width: 60, height: 60, left: 40, bottom: -30, background: t.preview.blobs[2] }} />
                {t.id === "neon" && (
                  <span
                    style={{
                      position: "absolute",
                      inset: 0,
                      backgroundImage:
                        "linear-gradient(rgba(163,230,53,.12) 1px,transparent 1px),linear-gradient(90deg,rgba(163,230,53,.12) 1px,transparent 1px)",
                      backgroundSize: "12px 12px",
                    }}
                  />
                )}
                <span className="tp-pill" style={{ background: t.preview.pill }} />
                <span
                  className="tp-card"
                  style={{
                    background: t.preview.card,
                    boxShadow: t.light
                      ? "inset 0 1px 0 #fff, 0 4px 12px rgba(42,54,110,.12)"
                      : t.id === "neon"
                        ? "inset 0 0 0 1px rgba(163,230,53,.7), 0 0 12px rgba(163,230,53,.35)"
                        : "inset 0 1px 0 rgba(255,255,255,.35)",
                  }}
                />
              </div>
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
            Hell am iPhone → Polar, dunkel → {prefs.theme === "polar" ? "Aurora" : THEMES.find((t) => t.id === prefs.theme)?.name}
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
