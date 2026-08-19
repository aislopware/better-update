import { Effect, Result } from "effect";

import { runResultWithLayerAndEnv, runWithLayerAndEnv } from "../../tests/helpers/runtime";
import { AnalyticsEngine, AnalyticsEngineLive, queryAnalyticsEngine } from "./analytics-engine";

const mockEnv = {
  ACCOUNT_ID: "test-account",
  CLOUDFLARE_API_TOKEN: "test-token",
  ANALYTICS_DATASET: "update_events",
  DELIVERY_ANALYTICS_DATASET: "delivery_events",
  // `provideCloudflareEnv` opens a D1 read-replication session per call; this
  // WAE-only path never touches it, so a stub binding suffices.
  DB: { withSession: () => ({}) },
} as unknown as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

const runQuery = async (sql: string) =>
  runWithLayerAndEnv(queryAnalyticsEngine(sql), AnalyticsEngineLive, mockEnv);

/** Every failure mode is the same tagged error; the reason is what differs. */
const runQueryReason = async (sql: string): Promise<string> => {
  const result = await runResultWithLayerAndEnv(
    queryAnalyticsEngine(sql),
    AnalyticsEngineLive,
    mockEnv,
  );
  return Result.isFailure(result) ? result.failure.reason : "<succeeded>";
};

const runDatasets = async (env: Env) =>
  runWithLayerAndEnv(
    Effect.gen(function* () {
      const client = yield* AnalyticsEngine;
      return yield* client.datasets;
    }),
    AnalyticsEngineLive,
    env,
  );

describe("analytics datasets", () => {
  it("reads the dataset names the deployment configured", async () => {
    await expect(
      runDatasets({ ...mockEnv, ANALYTICS_DATASET: "renamed_events" } as unknown as Env),
    ).resolves.toStrictEqual({ updates: "renamed_events", deliveries: "delivery_events" });
  });

  // The name is interpolated into SQL as a table name, so anything that is not
  // a plain identifier falls back rather than reaching the SQL API.
  it("falls back to the built-in name when the configured one is malformed", async () => {
    await expect(
      runDatasets({ ...mockEnv, DELIVERY_ANALYTICS_DATASET: "a; DROP TABLE" } as unknown as Env),
    ).resolves.toStrictEqual({ updates: "update_events", deliveries: "delivery_events" });
  });
});

describe(queryAnalyticsEngine, () => {
  it("returns data rows on successful query", async () => {
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

  it("returns an empty row set when the dataset has no matching rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ data: [], meta: [], rows: 0 })),
    );

    await expect(runQuery("SELECT 1")).resolves.toStrictEqual([]);
  });

  // The four cases below all used to degrade to an empty row set, which made a
  // broken read path look exactly like a project with no traffic.
  it("fails with the HTTP status on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 403 })));

    await expect(runQueryReason("SELECT 1")).resolves.toBe("Analytics Engine returned HTTP 403");
  });

  it("fails when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    await expect(runQueryReason("SELECT 1")).resolves.toBe("Analytics Engine request failed");
  });

  it("fails on an invalid JSON response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 200 })));

    await expect(runQueryReason("SELECT 1")).resolves.toBe(
      "Analytics Engine response was not valid JSON",
    );
  });

  it("fails when the response JSON lacks a data field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "bad query" }, { status: 200 })),
    );

    await expect(runQueryReason("SELECT 1")).resolves.toBe(
      "Analytics Engine response carried no data array",
    );
  });

  it("calls correct WAE API endpoint with auth", async () => {
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
