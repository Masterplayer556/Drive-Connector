import { useMemo, useState } from "react";
import { syncAccounts, writeLogs } from "../lib/db";
import { updateItem } from "../lib/google";
import { planSort } from "../lib/sortplan";
import type { Item } from "../lib/types";
import Icon from "./Icon";
import Ring from "./Ring";
import Thumb from "./Thumb";
import { useUI } from "./ui";
import { useKeepAwake } from "../lib/wakelock";

const key = (i: Item) => `${i.account_id}|${i.drive_id}`;

/** Sortieren-Knopf (Regel 12): markierte Fotos ordnen und ab der höchsten Zahl nummerieren. */
export default function SortSheet({
  selected,
  folderFiles,
  folderPath,
  onClose,
}: {
  selected: Item[];
  folderFiles: Item[];
  folderPath: string;
  onClose: (changed: boolean) => void;
}) {
  const ui = useUI();
  const [order, setOrder] = useState<string[]>([]);
  const [phase, setPhase] = useState<"order" | "run" | "done">("order");
  useKeepAwake(phase === "run"); // Bildschirm bleibt an, solange es läuft
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);

  const byKey = useMemo(() => new Map(selected.map((i) => [key(i), i])), [selected]);
  const ordered = useMemo(() => {
    const out = order.map((k) => byKey.get(k)!).filter(Boolean);
    for (const i of selected) if (!order.includes(key(i))) out.push(i);
    return out;
  }, [order, byKey, selected]);

  const selectedKeys = new Set(selected.map(key));
  const otherNames = folderFiles.filter((f) => !selectedKeys.has(key(f))).map((f) => f.name);
  const plan = planSort(
    ordered.map((i) => ({ id: key(i), name: i.name })),
    otherNames,
  );

  const toggle = (k: string) => setOrder((o) => (o.includes(k) ? o.filter((x) => x !== k) : [...o, k]));

  const run = async () => {
    const ok = await ui.confirm({
      title: `${plan.length} Foto${plan.length === 1 ? "" : "s"} umbenennen?`,
      message: `Neue Namen ${plan[0]?.to} bis ${plan[plan.length - 1]?.to}. Der alte Name wird in der Beschreibung gespeichert.`,
      confirmLabel: "Umbenennen",
    });
    if (!ok) return;
    setPhase("run");
    const errors: string[] = [];
    const logs = [];
    for (const step of plan) {
      const item = byKey.get(step.id)!;
      try {
        if (step.from !== step.to) {
          await updateItem(item.account_id, item.drive_id, { name: step.to, description: `Originalname: ${step.from}` });
          logs.push({ kind: "rename" as const, message: `„${step.from}“ → „${step.to}“ (Sortieren)`, details: { ordner: folderPath } });
        }
      } catch (e) {
        errors.push(`${step.from}: ${e instanceof Error ? e.message : String(e)}`);
      }
      setDone((d) => d + 1);
    }
    setFailed(errors);
    await writeLogs(logs);
    await syncAccounts([...new Set(selected.map((i) => i.account_id))]).catch(() => undefined);
    setPhase("done");
  };

  return (
    <>
      <div className="sheet-backdrop" />
      <div className="sheet">
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div style={{ minWidth: 0 }}>
            <div className="muted small ellipsis">in „{folderPath}“</div>
            <h2>{phase === "done" ? "Sortiert" : "Sortieren"}</h2>
          </div>
          {phase !== "run" && (
            <button className="icon-btn" onClick={() => onClose(phase === "done")} aria-label="Schliessen">
              <Icon name="x" />
            </button>
          )}
        </div>
        <div className="sheet-body">
          {phase === "order" && (
            <>
              <p className="muted small">
                Tippe die Fotos in der richtigen Reihenfolge an ({order.length}/{selected.length}). Nicht angetippte folgen
                danach. Nummeriert wird ab <strong>{plan[0]?.to.replace(/\.[^.]*$/, "")}</strong>.
              </p>
              <div className="row">
                <button className="btn small" onClick={() => setOrder(selected.map(key))}>
                  Alle der Reihe nach
                </button>
                {order.length > 0 && (
                  <button className="btn small ghost" onClick={() => setOrder([])}>
                    Zurücksetzen
                  </button>
                )}
              </div>
              <div className="grid stagger">
                {selected.map((it, i) => {
                  const k = key(it);
                  const pos = order.indexOf(k);
                  const target = plan.find((p) => p.id === k)?.to;
                  return (
                    <button
                      key={k}
                      className={`cell ${pos >= 0 ? "selected" : ""}`}
                      style={{ ["--i" as string]: i }}
                      onClick={() => toggle(k)}
                    >
                      <Thumb item={it} />
                      {pos >= 0 && <span className="badge">{pos + 1}</span>}
                      <span className="cell-name">{target}</span>
                    </button>
                  );
                })}
              </div>
              <ul className="names">
                {plan.map((p) => (
                  <li key={p.id}>
                    {p.from} → <strong>{p.to}</strong>
                  </li>
                ))}
              </ul>
              <button className="btn primary block" onClick={run}>
                <Icon name="sortNum" size={19} /> {plan.length} umbenennen
              </button>
            </>
          )}
          {phase === "run" && <Ring value={done} total={plan.length} label="umbenannt" />}
          {phase === "done" && (
            <>
              <div className="done-check">
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <h2 style={{ textAlign: "center" }}>{plan.length - failed.length} umbenannt</h2>
              {failed.length > 0 && (
                <div className="banner error" style={{ margin: 0, width: "100%", display: "block" }}>
                  <ul className="names">
                    {failed.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
              <button className="btn primary block" onClick={() => onClose(true)}>
                Fertig
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
