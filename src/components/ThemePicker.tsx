import { useEffect, useRef, useState } from "react";
import {
  BLEND_DEFAULT,
  BLEND_MAX,
  readFolderBlend,
  readPrefs,
  readStillBackground,
  resolveTheme,
  saveFolderBlend,
  savePrefs,
  saveStillBackground,
  THEMES,
  type ThemeId,
  type ThemeInfo,
  type ThemePrefs,
} from "../lib/theme";
import Icon from "./Icon";

const nameOf = (id: ThemeId) => THEMES.find((t) => t.id === id)?.name ?? id;

/** Kleine Ansicht der Startseite im jeweiligen Design: Titel, Speicher-Karte mit Ring, Archiv & Privat. */
export function ThemePreview({ t }: { t: ThemeInfo }) {
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

/**
 * Leiste mit allen Designs zum Durchwischen – ohne Einrasten: ein kräftiger Wisch fliegt bis ans Ende.
 * Das gewählte Design wird beim Öffnen in die Mitte geholt.
 */
function ThemeStrip({ selected, onPick, label }: { selected: ThemeId; onPick: (id: ThemeId) => void; label: string }) {
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = strip.current;
    const card = el?.querySelector<HTMLElement>(".theme-card.on");
    if (el && card) el.scrollLeft = card.offsetLeft - (el.clientWidth - card.offsetWidth) / 2;
    // nur beim Öffnen – nicht bei jedem Antippen herumspringen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="theme-strip" ref={strip} role="listbox" aria-label={label}>
      {THEMES.map((t) => {
        const on = selected === t.id;
        return (
          <button key={t.id} role="option" aria-selected={on} className={`theme-card ${on ? "on" : ""}`} onClick={() => onPick(t.id)}>
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
  );
}

/** Alles zu Design & Farbe: Designs, Automatisch hell/dunkel (eigene Wahl), Ordnerfarben, Hintergrund-Bewegung. */
export default function ThemePicker() {
  const [prefs, setPrefs] = useState<ThemePrefs>(readPrefs);
  const [blend, setBlend] = useState(readFolderBlend);
  const [still, setStill] = useState(readStillBackground);
  const changeBlend = (v: number) => {
    setBlend(v);
    saveFolderBlend(v);
  };

  const update = (next: ThemePrefs) => {
    setPrefs(next);
    savePrefs(next);
  };
  // Automatik aus: das gerade sichtbare Design bleibt (kein Sprung)
  const toggleAuto = (auto: boolean) => update(auto ? { ...prefs, auto } : { ...prefs, auto, theme: resolveTheme(prefs) });

  return (
    <>
      <div className="section-title">
        <span>Hell & Dunkel</span>
      </div>
      <label className="switch-row glass" style={{ margin: "4px 18px 0" }}>
        <span>
          <strong>Automatisch hell/dunkel</strong>
          <div className="muted small">
            {prefs.auto ? `Hell → ${nameOf(prefs.light)}, dunkel → ${nameOf(prefs.dark)}` : "Folgt dem Erscheinungsbild des iPhones"}
          </div>
        </span>
        <span className="switch">
          <input type="checkbox" checked={prefs.auto} onChange={(e) => toggleAuto(e.target.checked)} />
          <span />
        </span>
      </label>

      {prefs.auto ? (
        <>
          <div className="section-title">
            <span>☀︎ Bei hellem iPhone</span>
            <span className="faint">{nameOf(prefs.light)}</span>
          </div>
          <ThemeStrip label="Design bei hellem iPhone" selected={prefs.light} onPick={(light) => update({ ...prefs, light })} />
          <div className="section-title">
            <span>☾ Bei dunklem iPhone</span>
            <span className="faint">{nameOf(prefs.dark)}</span>
          </div>
          <ThemeStrip label="Design bei dunklem iPhone" selected={prefs.dark} onPick={(dark) => update({ ...prefs, dark })} />
        </>
      ) : (
        <>
          <div className="section-title">
            <span>Designs</span>
            <span className="faint">{THEMES.length}</span>
          </div>
          <ThemeStrip
            label="Design"
            selected={prefs.theme}
            onPick={(theme) => update({ ...prefs, theme })}
          />
        </>
      )}

      <div className="section-title">
        <span>Farben</span>
      </div>
      <div className="slider-row glass" style={{ margin: "4px 18px 0" }}>
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
            <input
              type="checkbox"
              checked={blend > 0}
              onChange={(e) => changeBlend(e.target.checked ? BLEND_DEFAULT : 0)}
              aria-label="Verlauf ein/aus"
            />
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
      <p className="faint small design-hint">
        <Icon name="info" size={14} /> Einzelne Ordner einfärben: Ordner gedrückt halten → Farbe.
      </p>

      <div className="section-title">
        <span>Bewegung</span>
      </div>
      <label className="switch-row glass" style={{ margin: "4px 18px 0" }}>
        <span>
          <strong>Hintergrund bewegen</strong>
          <div className="muted small">Nordlicht, Sonne, Raster … – aus spart etwas Akku</div>
        </span>
        <span className="switch">
          <input
            type="checkbox"
            checked={!still}
            onChange={(e) => {
              setStill(!e.target.checked);
              saveStillBackground(!e.target.checked);
            }}
          />
          <span />
        </span>
      </label>
    </>
  );
}
