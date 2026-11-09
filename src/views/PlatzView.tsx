import { useEffect, useMemo, useState } from "react";
import { HBars } from "../components/Charts";
import Icon from "../components/Icon";
import { LineSkeleton } from "../components/Skeleton";
import Thumb from "../components/Thumb";
import Topbar from "../components/Topbar";
import { useUI } from "../components/ui";
import { invalidateAll } from "../lib/cache";
import { fetchStats } from "../lib/db";
import { trashFiles } from "../lib/folders";
import { formatBytes } from "../lib/format";
import { navigate } from "../lib/route";
import { supabase } from "../lib/supabase";
import type { Item } from "../lib/types";

const COLS = "account_id,drive_id,name,is_folder,mime_type,parent_drive_id,size,md5,taken_at,description,path,parent_key";
const YEAR_AGO = () => new Date(Date.now() - 365 * 86_400_000).toISOString();

type Kind = "alle" | "videos" | "fotos";

/** Endung in Grossbuchstaben, z. B. „MP4“ (ohne Endung: Dateityp aus dem MIME-Typ). */
export function extOf(it: { name: string; mime_type: string | null }): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(it.name);
  if (m) return m[1].toUpperCase();
  return (it.mime_type?.split("/")[1] ?? "?").toUpperCase().slice(0, 5);
}

const key = (it: Item) => `${it.account_id}|${it.drive_id}`;

/** Platz sparen: grösste Dateien, Speicher nach Dateityp, alte Screenshots, Duplikate – auswählen und weg damit. */
export default function PlatzView() {
  const ui = useUI();
  const [types, setTypes] = useState<{ ext: string; files: number; bytes: number }[] | null>(null);
  const [big, setBig] = useState<Item[] | null>(null);
  const [shots, setShots] = useState<Item[] | null>(null);
  const [dups, setDups] = useState<number | null>(null);
  const [kind, setKind] = useState<Kind>("alle");
  const [selected, setSelected] = useState<Map<string, Item>>(new Map());
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [t, b, s] = await Promise.all([
      supabase.rpc("size_by_type"),
      supabase.from("items").select(COLS).eq("is_folder", false).not("path", "is", null).order("size", { ascending: false, nullsFirst: false }).limit(150),
      supabase
        .from("items")
        .select(COLS)
        .eq("is_folder", false)
        .not("path", "is", null)
        .or("name.ilike.*screenshot*,name.ilike.*bildschirmfoto*,path.ilike.*screenshots/*")
        .lt("created_time", YEAR_AGO())
        .order("size", { ascending: false, nullsFirst: false })
        .limit(500),
    ]);
    for (const r of [t, b, s]) if (r.error) throw new Error(r.error.message);
    setTypes(((t.data ?? []) as { ext: string; files: number; bytes: number }[]).map((r) => ({ ...r, files: Number(r.files), bytes: Number(r.bytes) })));
    setBig((b.data ?? []) as Item[]);
    setShots((s.data ?? []) as Item[]);
    fetchStats()
      .then((st) => setDups(st.duplicates))
      .catch(() => setDups(null));
  };

  useEffect(() => {
    load().catch((e) => ui.toast(e instanceof Error ? e.message : String(e), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(
    () =>
      (big ?? [])
        .filter((it) => kind === "alle" || (kind === "videos" ? it.mime_type?.startsWith("video/") : it.mime_type?.startsWith("image/")))
        .slice(0, 60),
    [big, kind],
  );
  const selBytes = [...selected.values()].reduce((s, it) => s + (it.size ?? 0), 0);
  const shotBytes = (shots ?? []).reduce((s, it) => s + (it.size ?? 0), 0);

  const toggle = (it: Item) =>
    setSelected((m) => {
      const n = new Map(m);
      if (n.has(key(it))) n.delete(key(it));
      else n.set(key(it), it);
      return n;
    });
  const selectAll = (list: Item[]) =>
    setSelected((m) => {
      const n = new Map(m);
      const all = list.every((it) => n.has(key(it)));
      for (const it of list) {
        if (all) n.delete(key(it));
        else n.set(key(it), it);
      }
      return n;
    });

  const trash = async () => {
    const items = [...selected.values()];
    const ok = await ui.confirm({
      title: `${items.length} ${items.length === 1 ? "Datei" : "Dateien"} in den Papierkorb?`,
      message: `Gibt ${formatBytes(selBytes)} frei, sobald der Papierkorb geleert ist (30 Tage zurückholbar).`,
      confirmLabel: "In den Papierkorb",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await trashFiles(items);
      invalidateAll();
      setSelected(new Map());
      ui.toast(r.failed.length ? `${r.ok} gelöscht, ${r.failed.length} fehlgeschlagen` : `${r.ok} Dateien im Papierkorb · ${formatBytes(selBytes)}`, r.failed.length ? "error" : "ok");
      await load();
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const total = (types ?? []).reduce((s, t) => s + t.bytes, 0);

  return (
    <div className={`view page-forward ${selected.size ? "has-actionbar" : ""}`}>
      <Topbar
        eyebrow={types ? `${formatBytes(total)} in Dateien` : "Lädt …"}
        title="Platz sparen"
        left={
          <button className="icon-btn" onClick={() => navigate("mehr")} aria-label="Zurück">
            <Icon name="chevronLeft" />
          </button>
        }
      />

      {!types ? (
        <LineSkeleton />
      ) : (
        <>
          <div className="section-title">
            <span>Nach Dateityp</span>
          </div>
          <section className="card glass">
            <HBars
              rows={types.slice(0, 8).map((t) => ({
                label: t.ext ? `.${t.ext}` : "ohne Endung",
                value: t.bytes,
                text: `${formatBytes(t.bytes)} · ${t.files.toLocaleString("de-CH")} ${t.files === 1 ? "Datei" : "Dateien"}`,
              }))}
            />
          </section>

          <div className="section-title">
            <span>Grösste Dateien</span>
          </div>
          <div className="chips pad" style={{ display: "flex", gap: 8 }}>
            {(["alle", "videos", "fotos"] as Kind[]).map((k) => (
              <button key={k} className={`chip ${kind === k ? "on" : ""}`} onClick={() => setKind(k)}>
                {k === "alle" ? "Alle" : k === "videos" ? "Videos" : "Fotos"}
              </button>
            ))}
          </div>
          <div className="list glass">
            {shown.map((it) => (
              <BigRow key={key(it)} item={it} on={selected.has(key(it))} onToggle={() => toggle(it)} />
            ))}
            {!shown.length && <div className="list-item muted small">Nichts gefunden</div>}
          </div>

          <div className="section-title">
            <span>Alte Screenshots</span>
            {!!shots?.length && (
              <button className="link small" onClick={() => selectAll(shots)}>
                Alle wählen
              </button>
            )}
          </div>
          <section className="card glass row between" style={{ flexWrap: "nowrap" }}>
            <span className="li-icon platz-icon" style={{ background: "linear-gradient(135deg,#60a5fa,#6366f1)" }}>
              <Icon name="image" size={18} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong>{shots?.length ? `${shots.length} Screenshots älter als 1 Jahr` : "Keine alten Screenshots"}</strong>
              <div className="muted small">{shots?.length ? `${formatBytes(shotBytes)} – meist nicht mehr gebraucht` : "Alles aufgeräumt"}</div>
            </span>
          </section>

          <div className="section-title">
            <span>Doppelte Fotos</span>
          </div>
          <button className="card glass row between platz-link" style={{ flexWrap: "nowrap" }} onClick={() => navigate("duplikate")}>
            <span className="li-icon platz-icon" style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)" }}>
              <Icon name="copy" size={18} />
            </span>
            <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
              <strong>{dups === null ? "Duplikate" : dups ? `${dups} doppelte Fotos` : "Keine Duplikate"}</strong>
              <div className="muted small">Gleiche Fotos in mehreren Ordnern oder Konten aufräumen</div>
            </span>
            <Icon name="chevronRight" size={18} className="faint" />
          </button>
        </>
      )}

      {selected.size > 0 && (
        <div className="actionbar glass platz-bar">
          <span className="small">
            <strong>{selected.size}</strong> gewählt · {formatBytes(selBytes)}
          </span>
          <div className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
            <button className="btn small ghost" onClick={() => setSelected(new Map())}>
              Abwählen
            </button>
            <button className="btn small danger-solid" disabled={busy} onClick={trash}>
              {busy ? <span className="spinner" /> : <Icon name="trash" size={16} />} Löschen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BigRow({ item, on, onToggle }: { item: Item; on: boolean; onToggle: () => void }) {
  const video = item.mime_type?.startsWith("video/");
  return (
    <button className={`list-item big-row ${on ? "on" : ""}`} onClick={onToggle}>
      <span className="big-thumb">
        <Thumb item={item} />
        {video && (
          <span className="big-play">
            <Icon name="play" size={12} />
          </span>
        )}
      </span>
      <span className="li-text">
        <span className="big-line">
          <strong className="big-size">{formatBytes(item.size ?? 0)}</strong>
          <span className={`ext-badge ${video ? "video" : ""}`}>.{extOf(item).toLowerCase()}</span>
        </span>
        <small className="ellipsis">{item.path}</small>
      </span>
      <span className={`check ${on ? "on" : ""}`}>{on && <Icon name="check" size={14} />}</span>
    </button>
  );
}
