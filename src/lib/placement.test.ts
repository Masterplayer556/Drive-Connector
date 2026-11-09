import { describe, expect, it } from "vitest";
import { areaOf, chooseAccount, crossesSealed, type AccountState } from "./placement";

const accounts: AccountState[] = [
  { id: "s1", role: "schule", free: 100, active: true },
  { id: "s2", role: "schule", free: 500, active: true },
  { id: "p1", role: "privat", free: 300, active: true },
  { id: "c1", role: "claude", free: 800, active: true },
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
  it("Claude ist abgeschottet: Claude-Ordner nur in Claude-Konten, nichts anderes dort", () => {
    expect(chooseAccount(accounts, { folderAccounts: [], area: "claude", size: 10 })).toBe("c1");
    expect(chooseAccount(accounts, { folderAccounts: ["c1"], area: "schule", size: 10 })).toBe("s2");
    expect(chooseAccount(accounts, { folderAccounts: [], area: "claude", size: 900 })).toBeNull();
  });
  it("ohne Bereich nie in ein abgeschottetes Konto (auch wenn dort am meisten frei ist)", () => {
    expect(chooseAccount(accounts, { folderAccounts: ["c1"], area: null, size: 10 })).toBe("s2");
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
    expect(areaOf("Claude/Projekte")).toBe("claude");
    expect(areaOf("Anderes")).toBeNull();
    expect(areaOf("")).toBeNull();
  });
});

describe("crossesSealed", () => {
  it("erkennt Wechsel in oder aus Privat", () => {
    expect(crossesSealed("Privat/Fotos", "Privat/Ferien")).toBe(false);
    expect(crossesSealed("Archiv/A", "Archiv/B")).toBe(false);
    expect(crossesSealed("Archiv/A", "Anderes")).toBe(false);
    expect(crossesSealed("Privat/Fotos", "Archiv/B")).toBe(true);
    expect(crossesSealed("Archiv/A", "Privat")).toBe(true);
    expect(crossesSealed("Privat/Fotos", "")).toBe(true);
  });
  it("Claude ist genauso abgeschottet – auch gegenüber Privat", () => {
    expect(crossesSealed("Claude/A", "Claude/B")).toBe(false);
    expect(crossesSealed("Claude/A", "Archiv")).toBe(true);
    expect(crossesSealed("Anderes", "Claude")).toBe(true);
    expect(crossesSealed("Privat/X", "Claude/Y")).toBe(true);
  });
});
