import { describe, expect, it } from "vitest";
import { trashedSince } from "./trash";

describe("trashedSince", () => {
  it("nimmt Googles trashedTime, wenn vorhanden", () => {
    expect(trashedSince({ trashedTime: "2026-11-01T10:00:00Z" }, "2026-11-20T10:00:00Z")).toBe(Date.parse("2026-11-01T10:00:00Z"));
  });
  it("fällt auf das eigene Datum zurück (Meine Ablage ohne trashedTime)", () => {
    expect(trashedSince({}, "2026-11-20T10:00:00Z")).toBe(Date.parse("2026-11-20T10:00:00Z"));
  });
  it("ohne beides unbekannt – nie löschen", () => {
    expect(trashedSince({}, undefined)).toBeNull();
    expect(trashedSince({ trashedTime: "kaputt" }, undefined)).toBeNull();
  });
});
