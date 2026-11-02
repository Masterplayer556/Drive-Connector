import { describe, expect, it } from "vitest";
import { areaOf, chooseAccount, type AccountState } from "./placement";

const accounts: AccountState[] = [
  { id: "s1", role: "schule", free: 100, active: true },
  { id: "s2", role: "schule", free: 500, active: true },
  { id: "p1", role: "privat", free: 300, active: true },
  { id: "x", role: "schule", free: 9999, active: false },
];

describe("chooseAccount", () => {
  it("bevorzugt das Konto, in dem der Ordner schon liegt", () => {
    expect(chooseAccount(accounts, { folderAccounts: ["s1"], area: "schule", size: 50 })).toBe("s1");
  });
  it("weicht aus, wenn das Ordner-Konto voll ist", () => {
    expect(chooseAccount(accounts, { folderAccounts: ["s1"], area: "schule", size: 200 })).toBe("s2");
  });
  it("nimmt bei neuen Ordnern ein Konto mit passender Rolle", () => {
    expect(chooseAccount(accounts, { folderAccounts: [], area: "privat", size: 10 })).toBe("p1");
  });
  it("nimmt jedes Konto, wenn die Rolle voll ist", () => {
    expect(chooseAccount(accounts, { folderAccounts: [], area: "privat", size: 400 })).toBe("s2");
  });
  it("ignoriert Konten mit Fehler und gibt null zurück, wenn nichts passt", () => {
    expect(chooseAccount(accounts, { folderAccounts: [], area: null, size: 1000 })).toBeNull();
  });
});

describe("areaOf", () => {
  it("liest den Bereich aus dem Pfad", () => {
    expect(areaOf("Archiv/Mathe")).toBe("schule");
    expect(areaOf("Schule/Mathe")).toBe("schule");
    expect(areaOf("privat")).toBe("privat");
    expect(areaOf("Anderes")).toBeNull();
    expect(areaOf("")).toBeNull();
  });
});
