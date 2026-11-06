// KI-SUCHE: Namen geben – im ✨-Fenster der Foto-Ansicht und für mehrere Fotos auf einmal
// (Auswahl → Tags). Die Suche nach dem Namen findet danach Fotos, die ähnlich aussehen
// (am besten bei Figuren mit festem Aussehen, siehe names.ts).
import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import type { Item } from "../lib/types";
import "./ai.css";
import { allNames, giveNameMany, namesOfMany, removeNameMany } from "./search";

export default function NameTags({ item, items: many }: { item?: Item; items?: Item[] }) {
  const items = many ?? (item ? [item] : []);
  const n = items.length;
  /** Name → bei wie vielen der Fotos */
  const [counts, setCounts] = useState<Map<string, { label: string; count: number }> | null>(null);
  const [known, setKnown] = useState<{ label: string; count: number }[]>([]);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    Promise.all([namesOfMany(items), allNames()])
      .then(([byItem, all]) => {
        const c = new Map<string, { label: string; count: number }>();
        for (const names of byItem.values()) {
          for (const label of names) {
            const k = label.toLowerCase();
            const e = c.get(k) ?? { label, count: 0 };
            e.count++;
            c.set(k, e);
          }
        }
        setCounts(c);
        setKnown(all);
      })
      .catch(() => setCounts(new Map()));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((i) => `${i.account_id}/${i.drive_id}`).join(",")]);

  const countOf = (label: string) => counts?.get(label.toLowerCase())?.count ?? 0;

  const add = async (label: string) => {
    const name = label.trim().replace(/\s+/g, " ");
    if (!name || countOf(name) === n) return setText("");
    setBusy(true);
    setNote(null);
    try {
      const { ok, unlearned } = await giveNameMany(items, name);
      if (!ok) setNote(n === 1 ? "Dieses Foto hat die KI noch nicht gelernt – später nochmals versuchen." : "Diese Fotos hat die KI noch nicht gelernt – später nochmals versuchen.");
      else {
        setText("");
        if (unlearned) setNote(`${unlearned} Foto${unlearned === 1 ? "" : "s"} noch nicht gelernt – dort später nochmals versuchen.`);
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (label: string) => {
    await removeNameMany(items, label);
    await load();
  };

  const present = [...(counts?.values() ?? [])].sort((a, b) => a.label.localeCompare(b.label, "de", { sensitivity: "base" }));
  const suggestions = known
    .filter((k) => countOf(k.label) === 0)
    .filter((k) => !text || k.label.toLowerCase().startsWith(text.trim().toLowerCase()))
    .slice(0, 8);

  return (
    <div className="ai-names">
      <div className="ai-names-head">
        <strong className="small">
          <Icon name="sparkles" size={13} /> Wer ist das?
        </strong>
        <span className="faint small">
          {n === 1 ? "Namen geben" : `Allen ${n} Fotos einen Namen geben`} – danach findet die KI-Suche nach dem Namen ähnliche Fotos.
        </span>
      </div>
      {present.length > 0 && (
        <div className="ai-name-chips">
          {present.map((m) => (
            <span key={m.label} className="ai-name-chip on">
              {m.label}
              {m.count < n && <span className="faint"> {m.count}/{n}</span>}
              {m.count < n && (
                <button onClick={() => void add(m.label)} disabled={busy} aria-label={`${m.label} allen geben`}>
                  <Icon name="plus" size={12} />
                </button>
              )}
              <button onClick={() => void remove(m.label)} aria-label={`${m.label} entfernen`}>
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <form
        className="ai-name-form"
        onSubmit={(e) => {
          e.preventDefault();
          void add(text);
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Name, z. B. Pikachu" enterKeyHint="done" autoCapitalize="words" autoCorrect="off" />
        <button className="btn small primary" disabled={!text.trim() || busy}>
          {busy ? <span className="spinner" style={{ width: 14, height: 14 }} /> : "Hinzufügen"}
        </button>
      </form>
      {suggestions.length > 0 && (
        <div className="ai-name-chips">
          {suggestions.map((k) => (
            <button key={k.label} className="ai-name-chip" onClick={() => void add(k.label)} disabled={busy}>
              + {k.label} <span className="faint">{k.count}</span>
            </button>
          ))}
        </div>
      )}
      {note && <p className="muted small" style={{ margin: 0 }}>{note}</p>}
    </div>
  );
}
