// KI-SUCHE (Test): „Fast gleiche Fotos“ in der Duplikate-Ansicht – Serienbilder, bearbeitete Kopien …
// Rechnet nur mit dem lokalen Index (kein Modell). Entfernen wie bei den normalen Duplikaten: in den Papierkorb.
import "./ai.css";
import { useState } from "react";
import Icon from "../components/Icon";
import Thumb from "../components/Thumb";
import { useUI } from "../components/ui";
import { invalidateAll } from "../lib/cache";
import { syncAccounts, writeLog } from "../lib/db";
import { trashItem } from "../lib/google";
import { accountColor } from "../lib/theme";
import type { Account, Item } from "../lib/types";
import { similarGroups } from "./search";
import { itemKey } from "./store";

const KEPT_KEY = "drivepool.ai.keepsim"; // Gruppen, die bewusst behalten werden
const PAGE = 10;

const signature = (g: Item[]) => g.map(itemKey).sort().join(",");
function kept(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEPT_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function keep(sig: string) {
  try {
    const all = [...kept(), sig].slice(-500);
    localStorage.setItem(KEPT_KEY, JSON.stringify(all));
  } catch {
    /* ignorieren */
  }
}

/** Standard: das grösste Foto behalten (meist das Original / die beste Qualität). */
const defaultKeep = (g: Item[]) => itemKey([...g].sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0]);

export default function AiSimilarDuplicates({ accounts }: { accounts: Account[] }) {
  const ui = useUI();
  const [groups, setGroups] = useState<Item[][] | null>(null);
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [shown, setShown] = useState(PAGE);

  const search = async () => {
    setBusy(true);
    try {
      const hidden = kept();
      const g = (await similarGroups()).filter((x) => !hidden.has(signature(x)));
      setGroups(g);
      setChoice(Object.fromEntries(g.map((x) => [signature(x), defaultKeep(x)])));
      setShown(PAGE);
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (g: Item[]) => {
    const sig = signature(g);
    const items = g.filter((i) => itemKey(i) !== choice[sig]);
    const ok = await ui.confirm({
      title: `${items.length} Foto${items.length === 1 ? "" : "s"} entfernen?`,
      message: "Das markierte Foto bleibt. Die anderen landen im Papierkorb.",
      confirmLabel: "Entfernen",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const touched = new Set<string>();
    let done = 0;
    for (const it of items) {
      try {
        await trashItem(it.account_id, it.drive_id);
        touched.add(it.account_id);
        done++;
      } catch {
        /* weiter */
      }
    }
    await writeLog("delete", `Fast gleiche Fotos aufgeräumt: ${done} Foto(s) in den Papierkorb`, {
      namen: items.map((i) => i.path),
    }).catch(() => undefined);
    await syncAccounts([...touched]).catch(() => undefined);
    invalidateAll();
    setGroups((gs) => gs?.filter((x) => signature(x) !== sig) ?? gs);
    setBusy(false);
    ui.toast(`${done} Foto${done === 1 ? "" : "s"} entfernt`, "ok");
  };

  const keepAll = (g: Item[]) => {
    const sig = signature(g);
    keep(sig);
    setGroups((gs) => gs?.filter((x) => signature(x) !== sig) ?? gs);
    ui.toast("Behalten – wird nicht mehr vorgeschlagen", "ok");
  };

  const accIndex = (id: string) => accounts.findIndex((a) => a.id === id);

  return (
    <>
      <div className="section-title">
        <span>
          <Icon name="sparkles" size={14} /> Fast gleiche Fotos (KI)
        </span>
        {groups && <span>{groups.length}</span>}
      </div>
      {groups === null ? (
        <div className="stack pad" style={{ gap: 8 }}>
          <p className="muted small" style={{ margin: 0 }}>
            Findet Serienbilder und bearbeitete Kopien, die nicht exakt gleich sind. Läuft nur auf diesem Gerät.
          </p>
          <button className="btn block" onClick={search} disabled={busy}>
            {busy ? <span className="spinner" /> : <Icon name="search" size={18} />} Fast gleiche Fotos suchen
          </button>
        </div>
      ) : groups.length === 0 ? (
        <p className="muted small pad">Keine fast gleichen Fotos gefunden (nur bereits gelernte Fotos werden verglichen).</p>
      ) : (
        <>
          <p className="muted small pad">Tippe das Foto an, das bleiben soll. Vorausgewählt ist jeweils das grösste.</p>
          <div className="stagger">
            {groups.slice(0, shown).map((g, gi) => {
              const sig = signature(g);
              return (
                <section key={sig} className="card glass dup-group" style={{ ["--i" as string]: gi }}>
                  <div className="row between small">
                    <span className="muted">{g.length}×</span>
                    <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      <button className="btn small ghost" onClick={() => keepAll(g)} disabled={busy}>
                        <Icon name="check" size={15} /> Behalten
                      </button>
                      <button className="btn small" onClick={() => remove(g)} disabled={busy}>
                        <Icon name="trash" size={15} /> {g.length - 1} entfernen
                      </button>
                    </span>
                  </div>
                  <div className="dup-row">
                    {g.map((it) => {
                      const on = choice[sig] === itemKey(it);
                      const ai = accIndex(it.account_id);
                      return (
                        <button key={itemKey(it)} className={`dup-item ${on ? "keep" : ""}`} onClick={() => setChoice((c) => ({ ...c, [sig]: itemKey(it) }))}>
                          <Thumb item={it} />
                          {on && <span className="dup-keep">Behalten</span>}
                          <span className="dup-path">
                            <span className="dot" style={{ background: accountColor(ai), color: accountColor(ai) }} />
                            {it.path}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
          {shown < groups.length && (
            <div className="stack pad">
              <button className="btn block" onClick={() => setShown((s) => s + PAGE)}>
                Weitere anzeigen ({groups.length - shown})
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
