import { describe, expect, it } from "vitest";
import { backoffMs, shouldRetry } from "./retry";

const json = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const reason = (r: string) => ({ error: { errors: [{ reason: r }] } });

describe("shouldRetry", () => {
  it("wiederholt, wenn Google bremst", async () => {
    expect(await shouldRetry(json(429), "POST")).toBe(true);
    expect(await shouldRetry(json(403, reason("userRateLimitExceeded")), "PATCH")).toBe(true);
    expect(await shouldRetry(json(403, reason("rateLimitExceeded")), "POST")).toBe(true);
  });

  it("wiederholt nicht bei echten Verboten", async () => {
    expect(await shouldRetry(json(403, reason("insufficientFilePermissions")), "PATCH")).toBe(false);
    expect(await shouldRetry(json(403, reason("storageQuotaExceeded")), "POST")).toBe(false);
    expect(await shouldRetry(new Response("kein JSON", { status: 403 }), "GET")).toBe(false);
    expect(await shouldRetry(json(404), "GET")).toBe(false);
    expect(await shouldRetry(json(401), "GET")).toBe(false);
  });

  it("wiederholt Server-Aussetzer nur, wenn nichts doppelt entstehen kann", async () => {
    expect(await shouldRetry(json(503), "GET")).toBe(true);
    expect(await shouldRetry(json(500), "patch")).toBe(true);
    expect(await shouldRetry(json(502), "DELETE")).toBe(true);
    expect(await shouldRetry(json(503), "POST")).toBe(false);
  });

  it("lässt die Antwort lesbar (Fehlermeldung wird danach noch gebraucht)", async () => {
    const res = json(403, { error: { message: "nein", errors: [{ reason: "forbidden" }] } });
    await shouldRetry(res, "GET");
    expect((await res.json()).error.message).toBe("nein");
  });
});

describe("backoffMs", () => {
  it("wartet jedes Mal etwa doppelt so lange", () => {
    const mid = () => 0.5;
    expect(backoffMs(0, undefined, mid)).toBe(600);
    expect(backoffMs(1, undefined, mid)).toBe(1200);
    expect(backoffMs(2, undefined, mid)).toBe(2400);
  });

  it("streut um ±25 %", () => {
    expect(backoffMs(0, undefined, () => 0)).toBe(450);
    expect(backoffMs(0, undefined, () => 1)).toBe(750);
  });

  it("hält sich an Retry-After, aber höchstens 20 s", () => {
    expect(backoffMs(0, json(429, {}, { "Retry-After": "3" }))).toBe(3000);
    expect(backoffMs(0, json(429, {}, { "Retry-After": "600" }))).toBe(20_000);
    expect(backoffMs(1, json(429, {}, { "Retry-After": "bald" }), () => 0.5)).toBe(1200);
  });
});
