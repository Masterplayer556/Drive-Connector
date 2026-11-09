import { useEffect, useRef, useState } from "react";
import { AREA_LABEL, ROLES } from "../lib/areas";
import { formatBytes } from "../lib/format";
import { accountColor } from "../lib/theme";
import type { Account, Role } from "../lib/types";
import { useCountUp } from "../lib/useCountUp";
import Donut from "./Donut";

interface Page {
  key: "pool" | Role;
  title: string;
  accounts: { a: Account; color: string }[];
}

/** Seiten: zuerst der ganze Pool, dann je ein Bereich mit seinen Konten (nur Bereiche, die Konten haben). */
export function poolPages(accounts: Account[]): Page[] {
  const all = accounts.map((a, i) => ({ a, color: accountColor(i) }));
  const pages: Page[] = [{ key: "pool", title: "Frei im Pool", accounts: all }];
  for (const r of ROLES) {
    const list = all.filter((x) => x.a.role === r);
    if (list.length) pages.push({ key: r, title: `Frei in ${AREA_LABEL[r]}`, accounts: list });
  }
  return pages;
}

/**
 * Speicher-Karte oben im Drive: nach links wischen zeigt Archiv, Privat und Claude einzeln.
 * Beim Hinwischen spielt das Diagramm seine Animation ab.
 */
export default function PoolCarousel({ accounts }: { accounts: Account[] }) {
  const pages = poolPages(accounts);
  const scroller = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  // Wie oft jede Seite schon ins Bild gewischt wurde (nach Seite, nicht nach Position – Seiten können dazukommen)
  const [plays, setPlays] = useState<Record<string, number>>({});
  const keyAt = useRef<string[]>([]);
  keyAt.current = pages.map((p) => p.key);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Neue Seite sichtbar → ihr Diagramm spielt die Animation
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const k = keyAt.current[index];
    if (k) setPlays((p) => ({ ...p, [k]: (p[k] ?? 0) + 1 }));
  }, [index]);

  const goTo = (i: number) => {
    const el = scroller.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  return (
    <section className="card glass enter pool-card">
      <div className="pool-pages" ref={scroller}>
        {pages.map((p) => (
          <PoolPage key={p.key} page={p} replay={plays[p.key] ?? 0} />
        ))}
      </div>
      {pages.length > 1 && (
        <div className="pool-dots" role="tablist" aria-label="Speicher nach Bereich">
          {pages.map((p, i) => (
            <button
              key={p.key}
              role="tab"
              aria-selected={i === index}
              aria-label={p.key === "pool" ? "Ganzer Pool" : AREA_LABEL[p.key]}
              className={`pool-dot ${i === index ? "on" : ""} dot-${p.key}`}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PoolPage({ page, replay }: { page: Page; replay: number }) {
  const active = page.accounts.filter((x) => x.a.status === "active");
  const total = active.reduce((s, x) => s + (x.a.quota_limit ?? 0), 0);
  const used = active.reduce((s, x) => s + (x.a.quota_usage ?? 0), 0);
  const free = useCountUp(Math.max(0, total - used) / 1024 ** 3);
  const segments = page.accounts
    .map((x) => ({ value: x.a.status === "active" ? (x.a.quota_usage ?? 0) : 0, color: x.color, label: x.a.email }))
    .filter((s) => s.value > 0);
  const n = page.accounts.length;

  return (
    <div className={`pool-page page-${page.key}`}>
      <div className="hero">
        <Donut segments={segments} total={total} replay={replay} />
        <div className="hero-info">
          <div className="muted small">{page.title}</div>
          <div className="hero-big">
            {free.toFixed(1)} <span className="muted" style={{ fontSize: "1rem" }}>GB</span>
          </div>
          <div className="muted small">
            von {formatBytes(total)} · {n} {n === 1 ? "Konto" : "Konten"}
          </div>
          <div className="legend">
            {page.accounts.map(({ a, color }) => (
              <div key={a.id} className="legend-row">
                <span className="dot" style={{ background: color, color }} />
                <span className="ellipsis">{a.email}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
