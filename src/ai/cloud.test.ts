import { describe, expect, it } from "vitest";
import { decodeVec, encodeVec } from "./cloud";

describe("KI: Fingerabdrücke kompakt speichern", () => {
  it("kommt fast gleich wieder heraus", () => {
    const v = new Float32Array(512).map(() => Math.random() - 0.5);
    const n = Math.hypot(...v);
    for (let i = 0; i < v.length; i++) v[i] /= n;
    const back = decodeVec(encodeVec(v));
    let dot = 0;
    for (let i = 0; i < v.length; i++) dot += v[i] * back[i];
    expect(back.length).toBe(512);
    expect(dot).toBeGreaterThan(0.999); // Ähnlichkeit zum Original
    expect(encodeVec(v).length).toBeLessThan(700);
  });
  it("Nullvektor bricht nicht", () => {
    expect(decodeVec(encodeVec(new Float32Array(4))).length).toBe(4);
  });
});
