import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import Segmented from "../components/Segmented";
import { LineSkeleton } from "../components/Skeleton";
import Topbar from "../components/Topbar";
import { useUI } from "../components/ui";
import { AREA_FOLDER, AREA_KEYS, AREA_LABEL, ROLES } from "../lib/areas";
import { invalidateAll } from "../lib/cache";
import { rootLevelItems, syncAccounts, writeLogs, type LogInput } from "../lib/db";
import { PathResolver } from "../lib/folders";
import { moveItem } from "../lib/google";
import { navigate } from "../lib/route";
import { accountColor, folderHue } from "../lib/theme";
import type { Account, Item, Role } from "../lib/types";

const key = (i: Item) => `${i.account_id}|${i.drive_id}`;

export default function EinrichtungView({ accounts, reload }: { accounts: Account[]; reload: () => Promise<void> }) {
  const ui = useUI();
  const [folders, setFolders] = useState<Item[] | null>(null);
  const [rootFiles, setRootFiles] = useState(0);
  const [choices, setChoices] = useState<Record<string, Role | null>>({});
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const items = await rootLevelItems();
    const f = items.filter((i) => i.is_folder && !AREA_KEYS.has(i.name.toLowerCase()));
    setFolders(f);
    setRootFiles(items.filter((i) => !i.is_folder).length);
    setChoices(Object.fromEntries(f.map((i) => [key(i), accounts.find((a) => a.id === i.account_id)?.role ?? null])));
  };

  useEffect(() => {
    load().catch((e) => ui.toast(e instanceof Error ? e.message : String(e), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setAll = (c: Role | null) => setChoices((old) => Object.fromEntries(Object.keys(old).map((k) => [k, c])));

  const apply = async () => {
    if (!folders) return;
    const todo = folders.filter((f) => choices[key(f)]);
    if (!todo.length) return;
    const ok = await ui.confirm({
      title: `${todo.length} Ordner einordnen?`,
      message: "Die Ordner werden innerhalb ihres Kontos verschoben – nichts wird kopiert oder umbenannt.",
      confirmLabel: "Einordnen",
    });
    if (!ok) return;
    setBusy(true);
    const resolver = new PathResolver(accounts);
    const logs: LogInput[] = [];
    const errors: string[] = [];
    for (const f of todo) {
      const area = AREA_FOLDER[choices[key(f)] as Role];
      const acc = accounts.find((a) => a.id === f.account_id);
      try {
        if (!acc?.root_folder_id) throw new Error("Konto nicht synchronisiert");
        const targetId = await resolver.ensure(acc.id, [area]);
        await moveItem(acc.id, f.drive_id, targetId, acc.root_folder_id);
        logs.push({ kind: "setup", message: `„${f.name}“ → „${area}/${f.name}“`, details: { konto: acc.email } });
      } catch (e) {
        errors.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await writeLogs(logs);
    await syncAccounts([...new Set(todo.map((f) => f.account_id))]);
    invalidateAll();
    await reload();
    await load();
    setBusy(false);
    if (errors.length) ui.toast(errors.join("\n"), "error");
    else ui.toast(`${logs.length} Ordner eingeordnet`, "ok");
  };

  const accIndex = (id: string) => accounts.findIndex((a) => a.id === id);

  return (
    <div className="view page-forward">
      <Topbar
        eyebrow="Mehr"
        title="Einrichtung"
        left={
          <button className="icon-btn" onClick={() => navigate("mehr")} aria-label="Zurück">
            <Icon name="chevronLeft" />
          </button>
        }
      />
      <p className="muted pad small">
        Ordne jeden Ordner der obersten Ebene „Archiv“, „Privat“ oder „Claude“ zu. Er wird innerhalb seines Kontos
        verschoben; liegt er im falschen Konto, holt ihn das Rebalancing ins richtige.
      </p>

      {folders === null ? (
        <LineSkeleton />
      ) : folders.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            <Icon name="checkCircle" size={34} />
          </div>
          <strong>Alles eingeordnet</strong>
          <button className="btn" onClick={() => navigate("drive")}>
            Zum Drive
          </button>
        </div>
      ) : (
        <>
          <div className="row pad" style={{ marginTop: 12 }}>
            {ROLES.map((r) => (
              <button key={r} className="btn small" onClick={() => setAll(r)}>
                Alle → {AREA_LABEL[r]}
              </button>
            ))}
            <button className="btn small ghost" onClick={() => setAll(null)}>
              Keine
            </button>
          </div>
          <div className="stagger">
            {folders.map((f, i) => (
              <section key={key(f)} className="card glass row between" style={{ ["--i" as string]: i, margin: "10px 18px" }}>
                <div className="row" style={{ minWidth: 0, flexWrap: "nowrap" }}>
                  <span className="folder-icon" style={{ ["--h" as string]: folderHue(f.name) }}>
                    <Icon name="folder" size={18} />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="ellipsis" style={{ fontWeight: 600 }}>
                      {f.name}
                    </div>
                    <div className="row small muted" style={{ flexWrap: "nowrap", gap: 6 }}>
                      <span className="dot" style={{ background: accountColor(accIndex(f.account_id)), color: accountColor(accIndex(f.account_id)) }} />
                      <span className="ellipsis">{accounts[accIndex(f.account_id)]?.email}</span>
                    </div>
                  </div>
                </div>
                <Segmented
                  value={choices[key(f)] ?? null}
                  onChange={(r) => setChoices((o) => ({ ...o, [key(f)]: o[key(f)] === r ? null : r }))}
                  options={ROLES.map((r) => ({ value: r, label: AREA_LABEL[r] }))}
                />
              </section>
            ))}
          </div>
          <div className="stack pad" style={{ marginTop: 8 }}>
            <button className="btn primary block" disabled={busy} onClick={apply}>
              {busy ? <span className="spinner" /> : <Icon name="check" size={19} />} Übernehmen
            </button>
          </div>
        </>
      )}
      {rootFiles > 0 && (
        <p className="faint small pad" style={{ marginTop: 14 }}>
          {rootFiles} Foto(s) liegen direkt auf der obersten Ebene. Sie bleiben dort.
        </p>
      )}
    </div>
  );
}
