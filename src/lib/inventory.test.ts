import { describe, expect, it } from "vitest";
import { inventoryCsv, toCsv } from "./inventory";
import type { Account } from "./types";

describe("toCsv", () => {
  it("trennt mit Semikolon und setzt Sonderfälle in Anführungszeichen", () => {
    expect(toCsv(["a", "b"], [["x;y", 'sag "hi"'], [null, 3]])).toBe('a;b\r\n"x;y";"sag ""hi"""\r\n;3\r\n');
  });
});

describe("inventoryCsv", () => {
  it("nennt Konto und Bereich zu jeder Datei, sortiert nach Pfad", () => {
    const accounts = [{ id: "p", email: "p@x", role: "privat" } as Account];
    const csv = inventoryCsv(
      [
        { account_id: "p", drive_id: "2", name: "b.jpg", is_folder: false, mime_type: "image/jpeg", size: 2048, md5: "m", taken_at: null, path: "Privat/b.jpg" },
        { account_id: "p", drive_id: "1", name: "a.jpg", is_folder: false, mime_type: null, size: null, md5: null, taken_at: null, path: "Privat/a.jpg" },
      ],
      accounts,
    );
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("p@x;Privat;Privat/a.jpg;a.jpg;Datei");
    expect(lines[2]).toContain("Privat/b.jpg");
  });
});
