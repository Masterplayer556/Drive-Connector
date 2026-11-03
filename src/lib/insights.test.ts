import { describe, expect, it } from "vitest";
import { computeInsights, LIMIT_15GB } from "./insights";
import type { Account } from "./types";

const GB = 1024 ** 3;
const acc = (id: string, used: number, limit = 15 * GB): Account => ({
  id, email: `${id}@x.ch`, role: "schule", root_folder_id: "r", quota_limit: limit, quota_usage: used,
  status: "active", status_message: null, last_sync_at: null, created_at: "",
});
const stats = { files: 1, bytes: 1, added_30d: 3 * GB, added_90d: 6 * GB, duplicates: 0 };

describe("computeInsights", () => {
  it("warnt ab 80/90/95 % Füllstand", () => {
    expect(computeInsights([acc("a", 12.5 * GB)], null, [])[0]).toMatchObject({ id: "fill", level: "info" });
    expect(computeInsights([acc("a", 13.6 * GB)], null, [])[0]).toMatchObject({ level: "warn" });
    expect(computeInsights([acc("a", 14.5 * GB)], null, [])[0]).toMatchObject({ level: "crit" });
    expect(computeInsights([acc("a", 5 * GB)], null, []).find((i) => i.id === "fill")).toBeUndefined();
  });
  it("zeigt keine „Voll in ca. …“-Prognose als Hinweis", () => {
    expect(computeInsights([acc("a", 5 * GB)], stats, []).find((i) => i.id === "forecast")).toBeUndefined();
  });
  it("meldet Ordner nahe und über 15 GB (Regel 4) zuerst", () => {
    const r = computeInsights([acc("a", 1 * GB)], null, [
      { parent_key: "x", path: "Archiv/X", bytes: LIMIT_15GB + 1, files: 10 },
      { parent_key: "y", path: "Archiv/Y", bytes: 14 * GB, files: 10 },
    ]);
    expect(r[0]).toMatchObject({ level: "crit", action: { kind: "folder", path: "Archiv/X" } });
    expect(r[1]).toMatchObject({ level: "warn" });
  });
  it("verweist auf Duplikate", () => {
    const r = computeInsights([acc("a", 1 * GB)], { ...stats, duplicates: 7 }, []);
    expect(r.find((i) => i.id === "dup")).toMatchObject({ title: "7 doppelte Fotos", action: { kind: "route", to: "duplikate" } });
  });
});
