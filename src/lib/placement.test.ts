import { describe, expect, it } from "vitest";
import { areaOf, chooseAccount, crossesPrivat, type AccountState } from "./placement";

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
  it("Privat ist abgeschottet: nie in ein Archiv-Konto ausweichen", () => {
    expect(chooseAccount(accounts, { folderAccounts: [], area: "privat", size: 400 })).toBeNull();
  });
  it("Archiv weicht nie in ein Privat-Konto aus – auch wenn der Ordner dort schon liegt", () => {
    expect(chooseAccount(accounts, { folderAccounts: ["p1"], area: "schule", size: 50 })).toBe("s2");
    expect(chooseAccount(accounts, { folderAccounts: [], area: "schule", size: 600 })).toBeNull();
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

describe("crossesPrivat", () => {
  it("erkennt Wechsel in oder aus Privat", () => {
    expect(crossesPrivat("Privat/Fotos", "Privat/Ferien")).toBe(false);
    expect(crossesPrivat("Archiv/A", "Archiv/B")).toBe(false);
    expect(crossesPrivat("Archiv/A", "Anderes")).toBe(false);
    expect(crossesPrivat("Privat/Fotos", "Archiv/B")).toBe(true);
    expect(crossesPrivat("Archiv/A", "Privat")).toBe(true);
    expect(crossesPrivat("Privat/Fotos", "")).toBe(true);
  });
});
