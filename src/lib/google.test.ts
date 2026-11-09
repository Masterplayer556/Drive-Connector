import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callFunction = vi.fn();
vi.mock("./supabase", () => ({ callFunction: (...a: unknown[]) => callFunction(...a) }));
// Wartezeiten zwischen den Versuchen im Test überspringen
vi.mock("./retry", async (orig) => ({ ...(await orig<typeof import("./retry")>()), backoffMs: () => 0 }));

import { clearTokens, createFolder, trashItem } from "./google";

const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const authOf = (call: number) => (fetchMock.mock.calls[call][1]?.headers as Record<string, string>).Authorization;

beforeEach(() => {
  clearTokens();
  let n = 0;
  callFunction.mockReset().mockImplementation(async () => ({
    tokens: [{ account_id: "a", access_token: `token${++n}`, expires_at: new Date(Date.now() + 3600_000).toISOString() }],
    errors: [],
  }));
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("Aufrufe an Google", () => {
  it("versucht es nochmals, wenn Google bremst", async () => {
    fetchMock.mockResolvedValueOnce(json(429)).mockResolvedValueOnce(json(200, { id: "x" }));
    await expect(trashItem("a", "x")).resolves.toEqual({ id: "x" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gibt nach drei Wiederholungen auf und meldet den Fehler von Google", async () => {
    fetchMock.mockImplementation(async () => json(503, { error: { message: "Backend Error" } }));
    await expect(trashItem("a", "x")).rejects.toThrow("Google (503): Backend Error");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("wiederholt einen Server-Aussetzer beim Anlegen nicht (sonst gäbe es den Ordner doppelt)", async () => {
    fetchMock.mockResolvedValueOnce(json(503, { error: { message: "Backend Error" } }));
    await expect(createFolder("a", "Neu", "root")).rejects.toThrow("503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("holt bei 401 einmal ein neues Token – auch nach einer Wiederholung", async () => {
    fetchMock.mockResolvedValueOnce(json(429)).mockResolvedValueOnce(json(401)).mockResolvedValueOnce(json(200, { id: "x" }));
    await trashItem("a", "x");
    expect([authOf(0), authOf(1), authOf(2)]).toEqual(["Bearer token1", "Bearer token1", "Bearer token2"]);
  });

  it("gibt ein zweites 401 weiter statt endlos neue Tokens zu holen", async () => {
    fetchMock.mockImplementation(async () => json(401, { error: { message: "Invalid Credentials" } }));
    await expect(trashItem("a", "x")).rejects.toThrow("Google (401)");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
