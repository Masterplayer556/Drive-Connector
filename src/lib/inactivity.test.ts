import { describe, expect, it } from "vitest";
import { inactivityOf } from "./inactivity";
import { computeInsights } from "./insights";
import type { Account } from "./types";

const NOW = Date.parse("2026-11-27T12:00:00Z");
const monthsAgo = (m: number) => new Date(NOW - m * 30.44 * 86_400_000 - 86_400_000).toISOString();

describe("inactivityOf", () => {
  it("frisch eingeloggt → alles gut", () => {
    expect(inactivityOf({ last_login_at: monthsAgo(2), created_at: monthsAgo(30) }, NOW)).toMatchObject({ level: "ok", months: 2, text: null });
  });
  it("gelb ab 12, rot ab 18 Monaten", () => {
    expect(inactivityOf({ last_login_at: monthsAgo(12), created_at: "" }, NOW).level).toBe("warn");
    const r = inactivityOf({ last_login_at: monthsAgo(19), created_at: "" }, NOW);
    expect(r.level).toBe("bad");
    expect(r.text).toContain("noch ~5 Monate");
  });
  it("ohne Bestätigung zählt das Verbinden des Kontos", () => {
    expect(inactivityOf({ last_login_at: null, created_at: monthsAgo(13) }, NOW)).toMatchObject({ level: "warn", months: 13 });
  });
  it("ohne Datum keine Warnung", () => {
    expect(inactivityOf({ created_at: "" }, NOW).level).toBe("ok");
  });
});

describe("Hinweis auf der Startseite", () => {
  it("erinnert ans Einloggen und führt zu den Konten", () => {
    const a: Account = {
      id: "a", email: "a@x.ch", role: "schule", root_folder_id: "r", quota_limit: 1, quota_usage: 0,
      status: "active", status_message: null, last_sync_at: null, last_login_at: monthsAgo(20), created_at: monthsAgo(30),
    };
    expect(computeInsights([a], null, []).find((i) => i.id === "idle-a")).toMatchObject({ level: "crit", action: { kind: "route", to: "konten" } });
  });
});
