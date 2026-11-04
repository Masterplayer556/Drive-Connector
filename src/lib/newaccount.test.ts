import { describe, expect, it } from "vitest";
import { splitBirthday, suggestUsername, usernameError } from "./newaccount";

describe("suggestUsername", () => {
  it("zählt beim häufigsten Muster weiter", () => {
    expect(suggestUsername(["tablettbee2@gmail.com", "tablettbee@gmail.com", "x@icloud.com"])).toBe("tablettbee3");
  });
  it("überspringt vergebene Nummern", () => {
    expect(suggestUsername(["pool1@gmail.com", "pool2@gmail.com", "pool5@gmail.com"])).toBe("pool6");
  });
  it("ohne Gmail-Konten: Standard", () => {
    expect(suggestUsername(["a@icloud.com"])).toBe("drivepool.pool1");
  });
});

describe("splitBirthday", () => {
  it("teilt wie bei Google", () => {
    expect(splitBirthday("2008-05-03")).toEqual({ day: "3", month: "Mai", year: "2008" });
    expect(splitBirthday("")).toBeNull();
  });
});

describe("usernameError", () => {
  it("prüft Gmail-Regeln", () => {
    expect(usernameError("tablettbee3")).toBeNull();
    expect(usernameError("abc")).not.toBeNull();
    expect(usernameError("a..bcdef")).not.toBeNull();
    expect(usernameError("hallo welt")).not.toBeNull();
  });
});
