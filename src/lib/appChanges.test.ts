import { describe, expect, it } from "vitest";
import { appChangeEntries, withAppChanges, type AppChange } from "./appChanges";
import type { LogEntry } from "./types";

const merge: AppChange = { type: "merge", at: "2026-11-06T22:34:00Z", pr: 66, title: "Duplikate nur im Ordner", sha: "e265ab54ea", commits: [{ at: "2026-11-06T22:30:00Z", title: "Hochladen: …" }] };
const push: AppChange = { type: "push", at: "2026-11-01T10:00:00Z", pr: null, title: "Fix", sha: "abc1234567", commits: [] };

describe("appChanges", () => {
  it("macht Protokoll-Einträge", () => {
    const [m, p] = appChangeEntries([merge, push]);
    expect(m.kind).toBe("app");
    expect(m.message).toBe("Merge #66: Duplikate nur im Ordner");
    expect(p.message).toBe("Push: Fix");
    expect(m.id).toBeLessThan(0);
  });
  it("sortiert mit den Datenbank-Einträgen", () => {
    const db: LogEntry[] = [{ id: 1, created_at: "2026-11-03T00:00:00Z", kind: "upload", message: "x", details: null }];
    expect(withAppChanges(db, [merge, push]).map((e) => e.id)).toEqual([-1, 1, -2]);
  });
});
