import { useEffect, useMemo, useState } from "react";
import { AreaLine, BarChart, HBars } from "../components/Charts";
import Icon from "../components/Icon";
import { LineSkeleton } from "../components/Skeleton";
import Topbar from "../components/Topbar";
import { AREA_LABEL } from "../lib/areas";
import { fetchStatistics, fetchStats, type AreaStat, type FolderStat, type KindStat, type MonthStat, type Snapshot } from "../lib/db";
import { formatBytes } from "../lib/format";
import type { PoolStats } from "../lib/insights";
import { navigate } from "../lib/route";
import type { Account } from "../lib/types";
import { useCountUp } from "../lib/useCountUp";

const monthShort = new Intl.DateTimeFormat("de-CH", { month: "narrow" });
const monthLong = new Intl.DateTimeFormat("de-CH", { month: "long", year: "numeric" });
const dayFmt = new Intl.DateTimeFormat("de-CH", { day: "numeric", month: "short" });

function areaName(a: string): string {
  const k = a.toLowerCase();
  if (!a) return "Oberste Ebene";
  if (k === "archiv" || k === "schule") return AREA_LABEL.schule;
  if (k === "privat") return AREA_LABEL.privat;
  if (k === "claude") return AREA_LABEL.claude;
  return a;
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat-tile glass">
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
      {sub && <span className="faint small">{sub}</span>}
    </div>
  );
}

/** Statistik (#14): Kennzahlen, Uploads pro Monat, Speicherverlauf, Bereiche, grösste Ordner. */
export default function StatistikView({ accounts }: { accounts: Account[] }) {
  const [data, setData] = useState<{ months: MonthStat[]; areas: AreaStat[]; folders: FolderStat[]; snapshots: Snapshot[]; kinds: KindStat[] } | null>(null);
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchStatistics(), fetchStats()])
      .then(([d, s]) => {
        setData(d);
        setStats(s);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const active = accounts.filter((a) => a.status === "active");
  const total = active.reduce((s, a) => s + (a.quota_limit ?? 0), 0);
  const used = active.reduce((s, a) => s + (a.quota_usage ?? 0), 0);
  // Fotos und Videos getrennt (ohne Aufteilung: alles als „Fotos“ wie bisher)
  const kind = (k: KindStat["kind"]) => data?.kinds.find((x) => x.kind === k);
  const split = !!data?.kinds.length;
  const photos = useCountUp(split ? (kind("foto")?.files ?? 0) : (stats?.files ?? 0));
  const videos = useCountUp(kind("video")?.files ?? 0);

  // Die letzten 12 Monate lückenlos (auch Monate ohne Uploads)
  const months = useMemo(() => {
    const byKey = new Map((data?.months ?? []).map((m) => [m.month.slice(0, 7), m]));
    const out = [];
    const d = new Date();
    d.setDate(1);
    for (let i = 11; i >= 0; i--) {
      const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
      const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
      const hit = byKey.get(key);
      const vids = hit?.videos ?? 0;
      const count =
        hit?.videos === undefined ? `${hit?.files ?? 0} Fotos` : `${(hit.files ?? 0) - vids} Fotos · ${vids} ${vids === 1 ? "Video" : "Videos"}`;
      out.push({
        label: monthShort.format(m),
        value: hit?.files ?? 0,
        detail: `${monthLong.format(m)}: ${count} · ${formatBytes(hit?.bytes ?? 0)}`,
      });
    }
    return out;
  }, [data]);

  const perMonth = stats ? (stats.added_90d / 3 || stats.added_30d) : 0;
  const daysLeft = perMonth > 0 ? ((total - used) / perMonth) * 30 : null;

  return (
    <div className="view page-forward">
      <Topbar
        eyebrow="Dein Pool in Zahlen"
        title="Statistik"
        left={
          <button className="icon-btn" onClick={() => navigate("mehr")} aria-label="Zurück">
            <Icon name="chevronLeft" />
          </button>
        }
      />
      {error && (
        <div className="banner error">
          <Icon name="alert" size={18} />
          {error}
        </div>
      )}
      {!data || !stats ? (
        <LineSkeleton count={10} />
      ) : (
        <>
          <div className="stat-tiles stagger">
            <Tile label="Fotos" value={Math.round(photos).toLocaleString("de-CH")} sub={split ? formatBytes(kind("foto")?.bytes ?? 0) : undefined} />
            {split && <Tile label="Videos" value={Math.round(videos).toLocaleString("de-CH")} sub={formatBytes(kind("video")?.bytes ?? 0)} />}
            <Tile label="Belegt" value={formatBytes(used)} sub={`von ${formatBytes(total)}`} />
            <Tile label="Pro Monat" value={formatBytes(perMonth)} sub="Ø letzte 3 Monate" />
            <Tile
              label="Voll in"
              value={daysLeft === null ? "–" : daysLeft > 365 ? `${(daysLeft / 365).toFixed(1)} J.` : `${Math.round(daysLeft / 30)} Mt.`}
              sub="bei diesem Tempo"
            />
          </div>

          <section className="card glass enter">
            <strong>{split ? "Neue Fotos & Videos pro Monat" : "Neue Fotos pro Monat"}</strong>
            <p className="faint small">Antippen für Details</p>
            <BarChart data={months} />
          </section>

          <section className="card glass enter">
            <strong>Speicherverlauf</strong>
            {data.snapshots.length >= 2 ? (
              <AreaLine
                points={data.snapshots.map((s) => ({ x: dayFmt.format(new Date(s.day)), y: s.usage }))}
                format={(v) => formatBytes(v)}
              />
            ) : (
              <p className="muted small" style={{ marginTop: 8 }}>
                Wird ab jetzt jede Nacht aufgezeichnet – nach ein paar Tagen erscheint hier der Verlauf.
              </p>
            )}
          </section>

          {split && (
            <section className="card glass enter">
              <strong>Fotos & Videos</strong>
              <p className="faint small">Platz nach Art</p>
              <HBars
                rows={data.kinds.map((k) => ({
                  label: k.kind === "foto" ? "Fotos" : k.kind === "video" ? "Videos" : "Andere Dateien",
                  value: k.bytes,
                  text: `${k.files.toLocaleString("de-CH")} · ${formatBytes(k.bytes)}`,
                }))}
              />
            </section>
          )}

          <section className="card glass enter">
            <strong>Bereiche</strong>
            <HBars rows={data.areas.map((a) => ({ label: areaName(a.area), value: a.bytes, text: `${a.files.toLocaleString("de-CH")} · ${formatBytes(a.bytes)}` }))} />
          </section>

          <section className="card glass enter">
            <strong>Grösste Ordner</strong>
            <HBars rows={data.folders.map((f) => ({ label: f.path, value: f.bytes, text: formatBytes(f.bytes) }))} />
          </section>
        </>
      )}
    </div>
  );
}
