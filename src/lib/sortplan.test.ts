import { describe, expect, it } from "vitest";
import { planSort } from "./sortplan";

describe("planSort", () => {
  it("zählt ab der höchsten Zahl der übrigen Fotos weiter (ohne Nullen)", () => {
    const r = planSort(
      [
        { id: "a", name: "IMG_9.jpg" },
        { id: "b", name: "x.png" },
      ],
      ["0080.png", "3.png", "Foto.png"],
    );
    expect(r.map((x) => x.to)).toEqual(["81.jpg", "82.png"]);
  });
  it("markierte Fotos zählen nicht zur höchsten Zahl", () => {
    const r = planSort([{ id: "a", name: "0080.png" }], ["1.png", "2.png"]);
    expect(r[0].to).toBe("3.png");
  });
  it("startet bei 1 ohne nummerierte Fotos", () => {
    expect(planSort([{ id: "a", name: "a.heic" }], [])[0].to).toBe("1.heic");
  });
});
