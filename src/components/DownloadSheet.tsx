import { useEffect, useMemo, useRef, useState } from "react";
import { formatBytes } from "../lib/format";
import { downloadBlob } from "../lib/google";
import type { Item } from "../lib/types";
import { buildZip, chunkBySize } from "../lib/zip";
import Icon from "./Icon";
import Ring from "./Ring";

const PHOTO_BATCH_BYTES = 150 * 1024 ** 2;
const PHOTO_BATCH_COUNT = 25;
const ZIP_PART_BYTES = 300 * 1024 ** 2;

type Mode = "photos" | "zip";

/** Massen-Download (Regel 13): Pakete über das Teilen-Menü – „Bilder sichern“ oder „In Dateien sichern“. */
export default function DownloadSheet({
  items,
  mode,
  title,
  basePath = "",
  onClose,
}: {
  items: Item[];
  mode: Mode;
  title: string;
  basePath?: string;
  onClose: () => void;
}) {
  const batches = useMemo(
    () =>
      mode === "photos"
        ? chunkBySize(items, (i) => i.size ?? 0, PHOTO_BATCH_BYTES, PHOTO_BATCH_COUNT)
        : chunkBySize(items, (i) => i.size ?? 0, ZIP_PART_BYTES),
    [items, mode],
  );
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const [ready, setReady] = useState<File[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const loadingFor = useRef(-1);

  // Paket im Hintergrund laden, sobald es an der Reihe ist
  useEffect(() => {
    if (finished || index >= batches.length || loadingFor.current === index) return;
    loadingFor.current = index;
    setReady(null);
    setLoaded(0);
    setError(null);
    const batch = batches[index];
    let alive = true;
    (async () => {
      try {
        const blobs: Blob[] = new Array(batch.length);
        let next = 0;
        await Promise.all(
          Array.from({ length: 3 }, async () => {
            while (next < batch.length) {
              const i = next++;
              blobs[i] = await downloadBlob(batch[i].account_id, batch[i].drive_id);
              if (alive) setLoaded((n) => n + 1);
            }
          }),
        );
        if (!alive) return;
        if (mode === "photos") {
          setReady(batch.map((it, i) => new File([blobs[i]], it.name, { type: blobs[i].type || "image/jpeg" })));
        } else {
          const prefix = basePath ? `${basePath}/` : "";
          const entries = await Promise.all(
            batch.map(async (it, i) => ({
              name: (it.path ?? it.name).startsWith(prefix) ? (it.path ?? it.name).slice(prefix.length) : it.name,
              data: new Uint8Array(await blobs[i].arrayBuffer()),
              date: it.taken_at ? new Date(it.taken_at) : undefined,
            })),
          );
          const zip = buildZip(entries);
          const part = batches.length > 1 ? ` (Teil ${index + 1})` : "";
          setReady([new File([zip], `${title}${part}.zip`, { type: "application/zip" })]);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
        loadingFor.current = -1;
      }
    })();
    return () => {
      alive = false;
    };
  }, [index, batches, mode, basePath, title, finished]);

  const save = async () => {
    if (!ready) return;
    try {
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: ready })) {
        await navigator.share({ files: ready });
      } else {
        for (const f of ready) {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(f);
          a.download = f.name;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
        }
      }
    } catch (e) {
      // Abbrechen im Teilen-Menü ist kein Fehler – Paket bleibt bereit
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (index + 1 >= batches.length) setFinished(true);
    else setIndex((i) => i + 1);
  };

  const batch = batches[index] ?? [];
  const batchBytes = batch.reduce((s, i) => s + (i.size ?? 0), 0);
  const totalBytes = items.reduce((s, i) => s + (i.size ?? 0), 0);
  const unit = mode === "photos" ? "Paket" : "Teil";

  return (
    <>
      <div className="sheet-backdrop" />
      <div className="sheet">
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div style={{ minWidth: 0 }}>
            <div className="muted small ellipsis">
              {items.length} Fotos · {formatBytes(totalBytes)}
            </div>
            <h2>{mode === "photos" ? "Fotos sichern" : "Als ZIP sichern"}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Schliessen">
            <Icon name="x" />
          </button>
        </div>
        <div className="sheet-body">
          {finished ? (
            <>
              <div className="done-check">
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <h2 style={{ textAlign: "center" }}>Alles gesichert</h2>
              <button className="btn primary block" onClick={onClose}>
                Fertig
              </button>
            </>
          ) : (
            <>
              {batches.length > 1 && (
                <div className="stat-chips">
                  {batches.map((_, i) => (
                    <span key={i} className={`stat-chip ${i < index ? "done" : i === index ? "on" : ""}`}>
                      {i < index ? "✓ " : ""}
                      {unit} {i + 1}
                    </span>
                  ))}
                </div>
              )}
              <Ring value={ready ? batch.length : loaded} total={batch.length} label="geladen" />
              <p className="muted small" style={{ textAlign: "center" }}>
                {unit} {index + 1} von {batches.length} · {formatBytes(batchBytes)}
                {mode === "zip" && !ready && loaded === batch.length ? " · ZIP wird erstellt …" : ""}
              </p>
              {error && (
                <div className="banner error" style={{ margin: 0, width: "100%" }}>
                  <Icon name="alert" size={18} />
                  {error}
                </div>
              )}
              <button className="btn primary block" disabled={!ready} onClick={save}>
                {ready ? (
                  <>
                    <Icon name="share" size={19} /> {unit} {index + 1} sichern
                  </>
                ) : (
                  <span className="spinner" />
                )}
              </button>
              <p className="faint small" style={{ textAlign: "center" }}>
                {mode === "photos"
                  ? "Im Teilen-Menü „Bilder sichern“ wählen – die Fotos landen in der Fotos-App."
                  : "Im Teilen-Menü „In Dateien sichern“ wählen."}
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
