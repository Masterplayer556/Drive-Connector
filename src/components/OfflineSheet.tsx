import { useEffect, useRef, useState } from "react";
import { formatBytes, formatDateTime } from "../lib/format";
import { makeOffline, offlineFolders, onOfflineChange, removeOffline, type OfflineFolder, type OfflineProgress } from "../lib/offline";
import { useKeepAwake } from "../lib/wakelock";
import Icon from "./Icon";
import Ring from "./Ring";
import { useUI } from "./ui";

/** Liste der offline gesicherten Ordner (aktualisiert sich bei Änderungen). */
export function useOfflineFolders(): OfflineFolder[] {
  const [list, setList] = useState(offlineFolders);
  useEffect(() => onOfflineChange(() => setList(offlineFolders())), []);
  return list;
}

/** Belegter und verfügbarer Speicher der App auf dem Gerät (soweit der Browser es verrät). */
function useStorageEstimate(deps: unknown[]): { usage: number; quota: number } | null {
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    navigator.storage
      ?.estimate?.()
      .then((e) => setEst({ usage: e.usage ?? 0, quota: e.quota ?? 0 }))
      .catch(() => setEst(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return est;
}

function Summary({ f }: { f: OfflineFolder }) {
  return (
    <span className="muted small">
      {f.photos} Fotos · {formatBytes(f.bytes)} · {formatDateTime(f.at)}
      {f.missing > 0 && ` · ${f.missing} ohne Vorschau`}
      {f.videos > 0 && ` · ${f.videos} Video${f.videos === 1 ? "" : "s"} nur mit Netz`}
    </span>
  );
}

/** Ordner offline verfügbar machen, aktualisieren oder wieder entfernen. */
export default function OfflineSheet({ folder, onClose }: { folder: { key: string; path: string; name: string }; onClose: () => void }) {
  const ui = useUI();
  const list = useOfflineFolders();
  const saved = list.find((f) => f.key === folder.key);
  const [progress, setProgress] = useState<OfflineProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const signal = useRef({ stop: false });
  useKeepAwake(busy && !!progress);
  const est = useStorageEstimate([list]);

  const run = async () => {
    signal.current = { stop: false };
    setBusy(true);
    setProgress({ done: 0, total: 1, phase: "folders" });
    try {
      const r = await makeOffline(folder, setProgress, signal.current);
      ui.toast(`„${folder.name}“ ist offline verfügbar (${r.photos} Fotos, ${formatBytes(r.bytes)})`, "ok");
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await removeOffline(folder.key);
      ui.toast(`„${folder.name}“ nicht mehr offline`, "ok");
      onClose();
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
      setBusy(false);
    }
  };

  // Auch ein Oberordner kann den Ordner schon mitsichern
  const parent = !saved ? list.find((f) => folder.key.startsWith(`${f.key}/`)) : undefined;

  return (
    <>
      <div className="sheet-backdrop" onClick={() => !busy && onClose()} />
      <div className="sheet">
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div style={{ minWidth: 0 }}>
            <div className="muted small ellipsis">{folder.path}</div>
            <h2>Offline verfügbar</h2>
          </div>
          {!busy && (
            <button className="icon-btn" onClick={onClose} aria-label="Schliessen">
              <Icon name="x" />
            </button>
          )}
        </div>
        <div className="sheet-body stack">
          {progress ? (
            <>
              <Ring value={progress.done} total={Math.max(1, progress.total)} label={progress.phase === "folders" ? "Ordner" : "Bilder"} />
              <p className="muted small" style={{ textAlign: "center" }}>
                Bitte die App offen lassen – der Bildschirm bleibt an.
              </p>
              <button className="btn block" onClick={() => (signal.current.stop = true)}>
                Abbrechen
              </button>
            </>
          ) : (
            <>
              <p className="muted small">
                Sichert die Fotos dieses Ordners samt Unterordnern auf diesem Gerät (Raster und grosse Ansicht) – so lassen sie
                sich auch ohne Netz ansehen, z. B. im Zug vor einer Prüfung. Videos und Originale brauchen weiterhin Netz.
              </p>
              {saved && (
                <div className="card glass stack" style={{ margin: 0, gap: 4 }}>
                  <strong>Ist offline verfügbar</strong>
                  <Summary f={saved} />
                </div>
              )}
              {parent && (
                <div className="banner" style={{ margin: 0, width: "100%" }}>
                  <Icon name="info" size={18} />
                  <span>Schon offline über „{parent.path}“.</span>
                </div>
              )}
              <button className="btn primary block" onClick={run} disabled={busy}>
                <Icon name="download" size={19} /> {saved ? "Aktualisieren" : "Offline sichern"}
              </button>
              {saved && (
                <button className="btn block danger" onClick={remove} disabled={busy}>
                  <Icon name="trash" size={18} /> Vom Gerät entfernen
                </button>
              )}
              {est && est.quota > 0 && (
                <span className="faint small" style={{ textAlign: "center" }}>
                  Die App belegt {formatBytes(est.usage)} auf diesem Gerät (verfügbar: {formatBytes(est.quota)}).
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** Alle offline gesicherten Ordner mit Speicherverbrauch – zum Entfernen (aus „Mehr“). */
export function OfflineList({ onClose }: { onClose: () => void }) {
  const ui = useUI();
  const list = useOfflineFolders();
  const [busy, setBusy] = useState<string | null>(null);
  const est = useStorageEstimate([list]);
  const total = list.reduce((s, f) => s + f.bytes, 0);
  const remove = async (f: OfflineFolder) => {
    setBusy(f.key);
    try {
      await removeOffline(f.key);
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div>
            <div className="muted small">{list.length ? `${list.length} Ordner · ${formatBytes(total)}` : "Noch nichts gesichert"}</div>
            <h2>Offline verfügbar</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Schliessen">
            <Icon name="x" />
          </button>
        </div>
        <div className="sheet-body stack">
          {!list.length && (
            <p className="muted small">Ordner gedrückt halten → „Offline verfügbar“. Die Fotos lassen sich dann auch ohne Netz ansehen.</p>
          )}
          {list.map((f) => (
            <div key={f.key} className="row between" style={{ gap: 8, flexWrap: "nowrap" }}>
              <span style={{ minWidth: 0, flex: 1 }}>
                <strong className="ellipsis" style={{ display: "block" }}>
                  {f.path}
                </strong>
                <Summary f={f} />
              </span>
              <button className="icon-btn" onClick={() => remove(f)} disabled={!!busy} aria-label={`„${f.path}“ vom Gerät entfernen`}>
                {busy === f.key ? <span className="spinner" /> : <Icon name="trash" size={18} />}
              </button>
            </div>
          ))}
          {est && est.quota > 0 && (
            <span className="faint small" style={{ textAlign: "center" }}>
              Die App belegt insgesamt {formatBytes(est.usage)} auf diesem Gerät (verfügbar: {formatBytes(est.quota)}).
            </span>
          )}
        </div>
      </div>
    </>
  );
}
