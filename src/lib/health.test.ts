import { describe, expect, it } from "vitest";
import { healthOf, sealSummary } from "./health";
import type { Account } from "./types";

const GB = 1024 ** 3;
const NOW = Date.parse("2026-11-09T12:00:00Z");
const acc = (p: Partial<Account> = {}): Account => ({
  id: "a",
  email: "a@x",
  role: "schule",
  root_folder_id: "r",
  quota_limit: 15 * GB,
  quota_usage: 5 * GB,
  status: "active",
  status_message: null,
  last_sync_at: "2026-11-09T06:00:00Z",
  created_at: "2026-11-01T00:00:00Z",
  ...p,
});

describe("healthOf", () => {
  it("grün, wenn alles passt", () => {
    expect(healthOf(acc(), 0, NOW)).toEqual({ level: "ok", reasons: [], daysToFull: null });
  });

  it("rot bei fehlendem Zugriff, gelb bei altem Abgleich", () => {
    expect(healthOf(acc({ status: "error", status_message: "Neu verbinden" }), 0, NOW).level).toBe("bad");
    expect(healthOf(acc({ last_sync_at: "2026-11-05T12:00:00Z" }), 0, NOW)).toMatchObject({ level: "warn", reasons: ["Seit 4 Tagen nicht abgeglichen"] });
    expect(healthOf(acc({ last_sync_at: "2026-10-20T12:00:00Z" }), 0, NOW).level).toBe("bad");
  });

  it("rechnet aus, wann das Konto voll ist", () => {
    // 10 GB frei, 6 GB in 30 Tagen → 0.2 GB/Tag → 50 Tage
    expect(healthOf(acc(), 6 * GB, NOW)).toMatchObject({ level: "ok", daysToFull: 50 });
    // 10 GB frei, 15 GB in 30 Tagen → 20 Tage → gelb
    expect(healthOf(acc(), 15 * GB, NOW)).toMatchObject({ level: "warn", daysToFull: 20, reasons: ["In ~20 Tagen voll"] });
  });

  it("Füllstand: ab 85 % gelb, ab 95 % rot – schlimmster Grund zuerst", () => {
    expect(healthOf(acc({ quota_usage: 13 * GB }), 0, NOW).level).toBe("warn");
    const h = healthOf(acc({ quota_usage: 14.5 * GB, last_sync_at: "2026-11-06T12:00:00Z" }), 0, NOW);
    expect(h.level).toBe("bad");
    expect(h.reasons[0]).toBe("97 % voll");
  });
});

describe("sealSummary", () => {
  it("meldet grün oder die Anzahl", () => {
    expect(sealSummary({ at: "", total: 0, items: [] })).toContain("✓");
    expect(sealSummary({ at: "", total: 3, items: [] })).toContain("3 Einträge liegen");
  });
});
