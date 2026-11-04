// Mehrere Fotos auswählen (z. B. in den Suchtreffern) und ihnen Tags geben.
import { lazy, Suspense, useState } from "react";
import type { Item } from "../lib/types";
import Icon from "./Icon";

const TagSheet = lazy(() => import("./TagSheet"));

const keyOf = (i: Item) => `${i.account_id}|${i.drive_id}`;

export function useSelection() {
  const [on, setOn] = useState(false);
  const [keys, setKeys] = useState<Set<string>>(new Set());
  return {
    on,
    has: (i: Item) => keys.has(keyOf(i)),
    toggle: (i: Item) =>
      setKeys((s) => {
        const n = new Set(s);
        if (n.has(keyOf(i))) n.delete(keyOf(i));
        else n.add(keyOf(i));
        return n;
      }),
    start: () => setOn(true),
    stop: () => {
      setOn(false);
      setKeys(new Set());
    },
    setAll: (items: Item[]) => setKeys(new Set(items.map(keyOf))),
    picked: (items: Item[]) => items.filter((i) => keys.has(keyOf(i))),
  };
}

export type Selection = ReturnType<typeof useSelection>;

/** Knopf „Auswählen“ / „Fertig“ für die Kopfzeile eines Rasters. */
export function SelectToggle({ sel }: { sel: Selection }) {
  return (
    <button className="link small" onClick={sel.on ? sel.stop : sel.start}>
      {sel.on ? "Abbrechen" : "Auswählen"}
    </button>
  );
}

/** Häkchen auf dem Vorschaubild. */
export function SelectCheck({ sel, item }: { sel: Selection; item: Item }) {
  if (!sel.on) return null;
  return <span className={`check ${sel.has(item) ? "on" : ""}`}>{sel.has(item) && <Icon name="check" size={15} />}</span>;
}

/** Leiste unten: Anzahl, alle/keine, Tags geben. */
export function SelectionBar({ sel, items }: { sel: Selection; items: Item[] }) {
  const [tagging, setTagging] = useState(false);
  if (!sel.on) return null;
  const picked = sel.picked(items);
  const all = picked.length === items.length && items.length > 0;
  return (
    <>
      <div className="select-bar glass">
        <span>
          <b>{picked.length}</b>
          <button className="link small" style={{ marginLeft: 8 }} onClick={() => (all ? sel.setAll([]) : sel.setAll(items))}>
            {all ? "Keine" : "Alle"}
          </button>
        </span>
        <button className="btn small primary" disabled={!picked.length} onClick={() => setTagging(true)}>
          <Icon name="tag" size={16} /> Tags
        </button>
      </div>
      {tagging && (
        <div className="select-tag-layer">
          <Suspense fallback={null}>
            <TagSheet items={picked} onClose={() => setTagging(false)} />
          </Suspense>
        </div>
      )}
    </>
  );
}
