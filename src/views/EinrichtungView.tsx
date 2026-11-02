import { useEffect, useState } from "react";
import { rootLevelItems, syncAccounts, writeLogs, type LogInput } from "../lib/db";
import { PathResolver } from "../lib/folders";
import { moveItem } from "../lib/google";
import { navigate } from "../lib/route";
import type { Account, Item } from "../lib/types";

type Choice = "" | "Schule" | "Privat";
const key = (i: Item) => `${i.account_id}|${i.drive_id}`;

export default function EinrichtungView({ accounts, reload }: { accounts: Account[]; reload: () => Promise<void> }) {
  const [folders, setFolders] = useState<Item[] | null>(null);
  const [rootFiles, setRootFiles] = useState(0);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = async () => {
    const items = await rootLevelItems();
    const f = items.filter((i) => i.is_folder && !["schule", "privat"].includes(i.name.toLowerCase()));
    setFolders(f);
    setRootFiles(items.filter((i) => !i.is_folder).length);
    setChoices(Object.fromEntries(f.map((i) => [key(i), accounts.find((a) => a.id === i.account_id)?.role === "privat" ? "Privat" : ""])));
  };

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setAll = (c: Choice) => setChoices((old) => Object.fromEntries(Object.keys(old).map((k) => [k, c])));

  const apply = async () => {
    if (!folders) return;
    const todo = folders.filter((f) => choices[key(f)]);
    if (!todo.length) return;
    if (!window.confirm(`${todo.length} Ordner verschieben? Es wird nichts kopiert und nichts umbenannt.`)) return;
    setBusy("Verschiebe …");
    setError(null);
    const resolver = new PathResolver(accounts);
    const logs: LogInput[] = [];
    const errors: string[] = [];
    for (const f of todo) {
      const area = choices[key(f)] as "Schule" | "Privat";
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
    await reload();
    await load();
    setBusy(null);
    if (errors.length) setError(errors.join("\n"));
    setDone(`${logs.length} Ordner eingeordnet.`);
  };

  const emailOf = (id: string) => accounts.find((a) => a.id === id)?.email ?? "";

  return (
    <div className="view">
      <header className="header">
        <h2>Einrichtung</h2>
      </header>
      <p className="muted pad">
        Ordne jeden Ordner der obersten Ebene „Schule“ oder „Privat“ zu. Er wird innerhalb seines Kontos verschoben –
        nichts wird kopiert oder umbenannt.
      </p>
      {error && <div className="banner error pre">{error}</div>}
      {done && <div className="banner ok">{done}</div>}
      {busy && <div className="banner">{busy}</div>}

      {folders === null ? (
        <p className="muted pad">Lädt …</p>
      ) : folders.length === 0 ? (
        <div className="stack pad">
          <p>Alles eingeordnet ✓</p>
          <button className="btn" onClick={() => navigate("drive")}>
            Zum Drive
          </button>
        </div>
      ) : (
        <>
          <div className="row pad">
            <button className="btn small" onClick={() => setAll("Schule")}>
              Alle → Schule
            </button>
            <button className="btn small" onClick={() => setAll("Privat")}>
              Alle → Privat
            </button>
            <button className="btn small ghost" onClick={() => setAll("")}>
              Keine
            </button>
          </div>
          {folders.map((f) => (
            <section key={key(f)} className="card row between">
              <div className="ellipsis">
                <div>📁 {f.name}</div>
                <div className="muted small ellipsis">{emailOf(f.account_id)}</div>
              </div>
              <div className="segmented">
                {(["Schule", "Privat"] as Choice[]).map((c) => (
                  <button
                    key={c}
                    className={choices[key(f)] === c ? "on" : ""}
                    onClick={() => setChoices((o) => ({ ...o, [key(f)]: o[key(f)] === c ? "" : c }))}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </section>
          ))}
          <div className="stack pad">
            <button className="btn primary" disabled={!!busy} onClick={apply}>
              Übernehmen
            </button>
          </div>
        </>
      )}
      {rootFiles > 0 && (
        <p className="muted small pad">
          {rootFiles} Foto(s) liegen direkt auf der obersten Ebene. Sie bleiben dort und erscheinen im Drive ganz oben.
        </p>
      )}
    </div>
  );
}
