import { runWithLayerAndEnv } from "../../tests/helpers/runtime";
import { AnalyticsEngineLive, queryAnalyticsEngine } from "./analytics-engine";

const mockEnv = {
  ACCOUNT_ID: "test-account",
  CF_API_TOKEN: "test-token",
} as unknown as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

const runQuery = async (sql: string) =>
  runWithLayerAndEnv(queryAnalyticsEngine(sql), AnalyticsEngineLive, mockEnv);

describe(queryAnalyticsEngine, () => {
  test("returns data rows on successful query", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            data: [{ blob1: "proj-1", count: "42" }],
            meta: [{ name: "blob1", type: "String" }],
            rows: 1,
            rows_before_limit_at_least: 1,
          },
          { status: 200 },
        ),
      ),
    );

    const result = await runQuery("SELECT 1");
    expect(result).toHaveLength(1);
    expect(result[0]?.["blob1"]).toBe("proj-1");
  });

  test("returns empty array on non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("error", { status: 500 })));

    const result = await runQuery("SELECT 1");
    expect(result).toEqual([]);
  });

  test("returns empty array when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    const result = await runQuery("SELECT 1");
    expect(result).toEqual([]);
  });

  test("returns empty array on invalid JSON response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 200 })));

    const result = await runQuery("SELECT 1");
    expect(result).toEqual([]);
  });

  test("returns empty array when response JSON lacks data field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "bad query" }, { status: 200 })),
    );

    const result = await runQuery("SELECT 1");
    expect(result).toEqual([]);
  });

  test("calls correct WAE API endpoint with auth", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: [],
        meta: [],
        rows: 0,
        rows_before_limit_at_least: 0,
      }),
    );
    vi.stubGlobal("fetch", mockFetch);

    await runQuery("SELECT blob1 FROM events");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/test-account/analytics_engine/sql",
      expect.objectContaining({
        method: "POST",
        body: "SELECT blob1 FROM events",
        headers: { Authorization: "Bearer test-token" },
      }),
    );
  });
});
