import { describe, expect, it } from "vitest";
import { mapPool } from "./pool";

const tick = () => new Promise((r) => setTimeout(r, 1));

describe("mapPool", () => {
  it("liefert die Ergebnisse in der Reihenfolge der Liste", async () => {
    const out = await mapPool([30, 10, 20], 3, async (n) => {
      await new Promise((r) => setTimeout(r, n / 10));
      return n * 2;
    });
    expect(out).toEqual([60, 20, 40]);
  });

  it("lässt nie mehr als das Limit gleichzeitig laufen", async () => {
    let running = 0;
    let peak = 0;
    await mapPool(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      peak = Math.max(peak, ++running);
      await tick();
      running--;
    });
    expect(peak).toBe(4);
  });

  it("kommt mit einer leeren Liste und einem Limit von 0 zurecht", async () => {
    expect(await mapPool([], 5, async () => 1)).toEqual([]);
    expect(await mapPool([1, 2], 0, async (n) => n)).toEqual([1, 2]);
  });

  it("gibt den Index mit", async () => {
    expect(await mapPool(["a", "b"], 2, async (s, i) => `${i}${s}`)).toEqual(["0a", "1b"]);
  });
});
