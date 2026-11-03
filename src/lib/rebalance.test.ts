import { describe, expect, it } from "vitest";
import { blockOf, GB, isLocked, letterGroup, planRebalance, type AccountCap, type Unit } from "./rebalance";

const acc = (id: string, usedGb: number, limitGb = 15): AccountCap => ({ id, email: id + "@x", limit: limitGb * GB, usage: usedGb * GB });
const unit = (account_id: string, path: string, gb: number, files = 100): Unit => ({
  account_id,
  path,
  parent_key: path.toLowerCase(),
  folder_id: account_id + ":" + path,
  files,
  bytes: gb * GB,
});

describe("letterGroup", () => {
  it("teilt nach Anfangsbuchstaben", () => {
    expect(letterGroup("Allen")).toBe("A–M");
    expect(letterGroup("Master Viper")).toBe("A–M");
    expect(letterGroup("Nala")).toBe("N–Z");
    expect(letterGroup("zebra")).toBe("N–Z");
    expect(letterGroup("Öl")).toBe("N–Z");
    expect(letterGroup("Ärger")).toBe("A–M");
    expect(letterGroup("2024")).toBe("A–M");
  });
});

describe("isLocked / blockOf", () => {
  it("Sperre gilt inkl. Unterordner, aber nicht für Namensvettern", () => {
    expect(isLocked("archiv/reisen", ["archiv/reisen"])).toBe(true);
    expect(isLocked("archiv/reisen/2020", ["archiv/reisen"])).toBe(true);
    expect(isLocked("archiv/reisen2", ["archiv/reisen"])).toBe(false);
  });
  it("Gruppenordner fasst Unterordner zu A–M / N–Z zusammen", () => {
    const g = "archiv/files";
    expect(blockOf({ parent_key: "archiv/files/kit", path: "Archiv/Files/Kit" }, g)).toEqual({ key: "archiv/files#A–M", label: "Archiv/Files (A–M)" });
    expect(blockOf({ parent_key: "archiv/files/nala/x", path: "Archiv/Files/Nala/x" }, g).key).toBe("archiv/files#N–Z");
    expect(blockOf({ parent_key: "archiv/reisen", path: "Archiv/Reisen" }, g).key).toBe("archiv/reisen");
  });
});

describe("planRebalance", () => {
  it("macht nichts, wenn alles ausgeglichen ist", () => {
    const p = planRebalance({ accounts: [acc("a", 8), acc("b", 7)], units: [unit("a", "Archiv/X", 8), unit("b", "Archiv/Y", 7)] });
    expect(p.steps).toEqual([]);
  });

  it("führt einen verteilten Ordner ins Konto mit dem grössten Teil zusammen", () => {
    const p = planRebalance({
      accounts: [acc("a", 10), acc("b", 6)],
      units: [unit("a", "Archiv/Reisen", 4), unit("b", "Archiv/Reisen", 1), unit("b", "Archiv/Y", 5)],
    });
    expect(p.steps).toHaveLength(1);
    expect(p.steps[0]).toMatchObject({ block: "archiv/reisen", from: "b", to: "a", reason: "zusammenführen" });
    expect(p.after.a).toBeCloseTo(11 * GB);
  });

  it("entlastet ein volles Konto ins leere neue Konto – lieber ein grosser Block als viele kleine", () => {
    const p = planRebalance({
      accounts: [acc("voll", 14.6), acc("neu", 0)],
      units: [unit("voll", "Archiv/A", 1), unit("voll", "Archiv/B", 1), unit("voll", "Archiv/C", 3), unit("voll", "Archiv/D", 9.6)],
    });
    expect(p.steps).toHaveLength(1);
    expect(p.steps[0]).toMatchObject({ block: "archiv/c", from: "voll", to: "neu", reason: "entlasten" });
    expect(p.after.voll).toBeLessThanOrEqual(0.85 * 15 * GB);
  });

  it("verschiebt nie gesperrte Ordner", () => {
    const p = planRebalance({
      accounts: [acc("voll", 14.6), acc("neu", 0)],
      units: [unit("voll", "Archiv/C", 3), unit("voll", "Archiv/D", 11.6)],
      locks: ["archiv/c"],
    });
    expect(p.steps.find((s) => s.block === "archiv/c")).toBeUndefined();
  });

  it("hält im Ziel immer Reserve frei und überfüllt es nicht", () => {
    const p = planRebalance({
      accounts: [acc("voll", 14.8), acc("fast", 12)],
      units: [unit("voll", "Archiv/C", 2), unit("voll", "Archiv/D", 12.8)],
    });
    expect(p.steps).toEqual([]);
  });

  it("bewegt eine Buchstabengruppe als Ganzes", () => {
    const p = planRebalance({
      accounts: [acc("voll", 14.5), acc("neu", 1)],
      units: [
        unit("voll", "Archiv/Files/Allen", 2),
        unit("voll", "Archiv/Files/Kit", 2),
        unit("voll", "Archiv/Files/Nala", 1.5),
        unit("voll", "Archiv/Files/Zorro", 1.5),
        unit("voll", "Privat/Fotos", 7.5),
        unit("neu", "Privat/Neu", 1),
      ],
      groupFolder: "archiv/files",
    });
    const s = p.steps.find((x) => x.block === "archiv/files#N–Z");
    expect(s).toBeDefined();
    expect(s!.units.map((u) => u.path).sort()).toEqual(["Archiv/Files/Nala", "Archiv/Files/Zorro"]);
    expect(s!.bytes).toBeCloseTo(3 * GB);
  });

  it("zieht nie doppelt um: Zusammenführen + Entlasten wird ein direkter Schritt", () => {
    const p = planRebalance({
      accounts: [acc("a", 14), acc("b", 13), acc("neu", 0)],
      units: [unit("a", "Archiv/G", 3.4), unit("a", "Archiv/M", 10), unit("b", "Archiv/G", 0.6), unit("b", "Archiv/S", 12)],
    });
    const g = p.steps.filter((s) => s.block === "archiv/g");
    for (const s of g) expect(s.to).toBe("neu");
    expect(new Set(p.steps.map((s) => s.block + s.from)).size).toBe(p.steps.length);
    expect(p.steps.every((s) => s.units.every((u) => u.account_id === s.from))).toBe(true);
  });

  it("gleiche Lage → gleiche Signatur (abgelehnte Vorschläge kommen nicht wieder)", () => {
    const input = { accounts: [acc("voll", 14.6), acc("neu", 0)], units: [unit("voll", "Archiv/C", 3), unit("voll", "Archiv/D", 11.6)] };
    expect(planRebalance(input).signature).toBe(planRebalance(input).signature);
    expect(planRebalance(input).signature).not.toBe("");
  });

  it("Privat ist abgeschottet: nichts zieht zwischen Privat- und Archiv-Konten um", () => {
    const priv = (id: string, usedGb: number): AccountCap => ({ ...acc(id, usedGb), role: "privat" });
    const arch = (id: string, usedGb: number): AccountCap => ({ ...acc(id, usedGb), role: "schule" });
    // Volles Archiv-Konto, leeres Privat-Konto → kein Vorschlag
    const p1 = planRebalance({ accounts: [arch("a", 14.6), priv("p", 0)], units: [unit("a", "Archiv/X", 4), unit("a", "Archiv/Y", 10.6)] });
    expect(p1.steps).toEqual([]);
    // Volles Privat-Konto: Privat-Ordner ziehen nur ins andere Privat-Konto
    const p2 = planRebalance({
      accounts: [priv("p1", 14.6), arch("a", 0), priv("p2", 2)],
      units: [unit("p1", "Privat/Fotos", 4), unit("p1", "Privat/Ferien", 10.6), unit("p2", "Privat/Anderes", 2)],
    });
    expect(p2.steps.length).toBeGreaterThan(0);
    for (const s of p2.steps) expect(s.to).toBe("p2");
    // Verteilter Privat-Ordner wird nie in ein Archiv-Konto zusammengeführt
    const p3 = planRebalance({
      accounts: [arch("a", 3), priv("p", 13)],
      units: [unit("a", "Privat/Fotos", 3), unit("p", "Privat/Fotos", 1), unit("p", "Privat/Rest", 12)],
    });
    expect(p3.steps.every((s) => s.to === "p")).toBe(true);
  });
});
