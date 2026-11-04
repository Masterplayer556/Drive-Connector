// Tags und Merkzeichen geben – für ein Foto (Foto-Ansicht) oder mehrere (Auswahl).
import { useState } from "react";
import { addTag, allTags, cleanTag, MARKERS, markerColor, removeTag, tagsOf, useTags } from "../lib/tags";
import type { Item } from "../lib/types";
import Icon from "./Icon";
import { useUI } from "./ui";

export default function TagSheet({ items, onClose }: { items: Item[]; onClose: () => void }) {
  useTags();
  const ui = useUI();
  const [text, setText] = useState("");
  const n = items.length;

  // Wie viele der Fotos haben den Tag? (alle = an, einige = teilweise)
  const countOf = (tag: string) => items.filter((i) => tagsOf(i).some((t) => t.toLowerCase() === tag.toLowerCase())).length;
  const present = allTags().filter((t) => countOf(t.tag) > 0 && !t.color);
  const others = allTags().filter((t) => countOf(t.tag) === 0 && !t.color);
  const typed = cleanTag(text).toLowerCase();
  const suggestions = others.filter((t) => !typed || t.tag.toLowerCase().includes(typed)).slice(0, 12);

  const run = (p: Promise<void>) => p.catch((e) => ui.toast(e instanceof Error ? e.message : String(e), "error"));
  const toggle = (tag: string) => run(countOf(tag) === n ? removeTag(items, tag) : addTag(items, tag));
  const add = () => {
    const t = cleanTag(text);
    if (!t) return;
    setText("");
    void run(addTag(items, t));
  };

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet tag-sheet">
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div style={{ minWidth: 0 }}>
            <div className="muted small ellipsis">{n === 1 ? items[0].name : `${n} Fotos`}</div>
            <h2>Tags & Merkzeichen</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fertig">
            <Icon name="x" />
          </button>
        </div>
        <div className="sheet-body">
          <div className="tag-markers" role="group" aria-label="Merkzeichen">
            {MARKERS.map((m) => {
              const c = countOf(m.tag);
              return (
                <button
                  key={m.tag}
                  className={`tag-marker ${c === n ? "on" : c ? "some" : ""}`}
                  style={{ ["--c" as string]: m.color }}
                  onClick={() => void toggle(m.tag)}
                  aria-pressed={c === n}
                  aria-label={m.tag}
                >
                  {c === n && <Icon name="check" size={16} />}
                </button>
              );
            })}
          </div>

          {present.length > 0 && (
            <div className="tag-chips">
              {present.map((t) => {
                const c = countOf(t.tag);
                return (
                  <span key={t.tag} className={`tag-chip on ${c < n ? "some" : ""}`}>
                    #{t.tag}
                    {c < n && <span className="faint"> {c}/{n}</span>}
                    {c < n && (
                      <button onClick={() => void run(addTag(items, t.tag))} aria-label={`${t.tag} allen geben`}>
                        <Icon name="plus" size={12} />
                      </button>
                    )}
                    <button onClick={() => void run(removeTag(items, t.tag))} aria-label={`${t.tag} entfernen`}>
                      <Icon name="x" size={12} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          <form
            className="tag-form"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <span className="tag-form-hash">#</span>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Neuer Tag, z. B. Ferien"
              enterKeyHint="done"
              autoCorrect="off"
              maxLength={41}
            />
            <button className="btn small primary" disabled={!cleanTag(text)}>
              Hinzufügen
            </button>
          </form>

          {suggestions.length > 0 && (
            <>
              <div className="faint small">Bisherige Tags</div>
              <div className="tag-chips">
                {suggestions.map((t) => (
                  <button key={t.tag} className="tag-chip" onClick={() => void run(addTag(items, t.tag))}>
                    + {t.tag} <span className="faint">{t.count}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <p className="faint small" style={{ margin: 0 }}>
            Finden: in der Suche „#Tag“ eingeben, z. B. „#Ferien“ oder „#Rot“ – auch zusammen mit der KI-Suche.
          </p>
        </div>
      </div>
    </>
  );
}

/** Kleine Punkte (Merkzeichen) und ein Tag-Zeichen (andere Tags) auf dem Vorschaubild. */
export function TagDots({ item }: { item: Item }) {
  const tags = tagsOf(item);
  if (!tags.length) return null;
  const colors = tags.map(markerColor).filter((c): c is string => !!c);
  const plain = tags.length - colors.length;
  return (
    <span className="tag-dots" aria-label={`Tags: ${tags.join(", ")}`}>
      {colors.slice(0, 4).map((c) => (
        <i key={c} style={{ background: c }} />
      ))}
      {plain > 0 && <Icon name="tag" size={11} />}
    </span>
  );
}
