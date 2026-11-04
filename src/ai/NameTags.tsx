// KI-SUCHE (Test): Namen geben – im ✨-Fenster der Foto-Ansicht. Die Suche nach dem Namen findet danach
// Fotos, die ähnlich aussehen (am besten bei Figuren mit festem Aussehen, siehe names.ts).
import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import type { Item } from "../lib/types";
import { allNames, giveName, namesOf, removeName } from "./search";

export default function NameTags({ item }: { item: Item }) {
  const [mine, setMine] = useState<string[] | null>(null);
  const [known, setKnown] = useState<{ label: string; count: number }[]>([]);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    Promise.all([namesOf(item), allNames()])
      .then(([m, all]) => {
        setMine(m);
        setKnown(all);
      })
      .catch(() => setMine([]));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  const has = (label: string) => (mine ?? []).some((m) => m.toLowerCase() === label.toLowerCase());

  const add = async (label: string) => {
    const name = label.trim().replace(/\s+/g, " ");
    if (!name || has(name)) return setText("");
    setBusy(true);
    setNote(null);
    try {
      const ok = await giveName(item, name);
      if (!ok) setNote("Dieses Foto hat die KI noch nicht gelernt – später nochmals versuchen.");
      else setText("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (label: string) => {
    await removeName(item, label);
    await load();
  };

  const suggestions = known.filter((k) => !has(k.label)).filter((k) => !text || k.label.toLowerCase().startsWith(text.trim().toLowerCase())).slice(0, 8);

  return (
    <div className="ai-names">
      <div className="ai-names-head">
        <strong className="small">Wer ist das?</strong>
        <span className="faint small">Namen geben – danach findet die Suche nach dem Namen ähnliche Fotos.</span>
      </div>
      {mine && mine.length > 0 && (
        <div className="ai-name-chips">
          {mine.map((m) => (
            <span key={m} className="ai-name-chip on">
              {m}
              <button onClick={() => void remove(m)} aria-label={`${m} entfernen`}>
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
            <button key={k.label} className="ai-name-chip" onClick={() => void add(k.label)}>
              + {k.label} <span className="faint">{k.count}</span>
            </button>
          ))}
        </div>
      )}
      {note && <p className="muted small" style={{ margin: 0 }}>{note}</p>}
    </div>
  );
}
