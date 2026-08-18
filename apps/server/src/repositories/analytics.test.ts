import { Effect, Layer } from "effect";

import { AnalyticsEngine, AnalyticsUnavailable } from "../cloudflare/analytics-engine";
import { AnalyticsRepo, AnalyticsRepoLive } from "./analytics";

import type { AERow } from "../cloudflare/analytics-engine";
import type { AnalyticsRepository } from "./analytics";

const PROJECT_ID = "11111111-2222-3333-4444-555555555555";

const datasets = { updates: "update_events", deliveries: "delivery_events" };

/** A stub AE that answers every query from one canned row set. */
const stubEngine = (rows: readonly AERow[]) =>
  Layer.succeed(AnalyticsEngine, {
    datasets: Effect.succeed(datasets),
    query: () => Effect.succeed(rows),
  });

/** A stub AE that is down — the case the `unavailable` flag exists for. */
const downEngine = Layer.succeed(AnalyticsEngine, {
  datasets: Effect.succeed(datasets),
  query: () =>
    Effect.fail(
      new AnalyticsUnavailable({ reason: "Analytics Engine returned HTTP 403", cause: undefined }),
    ),
});

const runRepo = async <Result>(
  engine: Layer.Layer<AnalyticsEngine>,
  use: (repo: AnalyticsRepository) => Effect.Effect<Result>,
): Promise<Result> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const repo = yield* AnalyticsRepo;
      return yield* use(repo);
    }).pipe(Effect.provide(AnalyticsRepoLive.pipe(Layer.provide(engine)))),
  );

describe("AnalyticsRepo when Analytics Engine is unreachable", () => {
  // Zeros with no flag are indistinguishable from a project nobody runs, which
  // is what made a missing CLOUDFLARE_API_TOKEN invisible.
  it("degrades adoption to an empty result flagged unavailable", async () => {
    const result = await runRepo(downEngine, (repo) => repo.getAdoption({ projectId: PROJECT_ID }));

    expect(result).toStrictEqual({ updates: [], unavailable: true });
  });

  it("degrades platform metrics to an empty result flagged unavailable", async () => {
    const result = await runRepo(downEngine, (repo) =>
      repo.getPlatformMetrics({ projectId: PROJECT_ID }),
    );

    expect(result).toStrictEqual({ platforms: [], unavailable: true });
  });

  it("keeps the requested channel name on the unavailable result", async () => {
    const result = await runRepo(downEngine, (repo) =>
      repo.getChannelMetrics({ projectId: PROJECT_ID, channel: "production" }),
    );

    expect(result.channel).toBe("production");
    expect(result.unavailable).toBe(true);
    expect(result.totalRequests).toBe(0);
  });

  it("degrades delivery metrics to zeros flagged unavailable", async () => {
    const result = await runRepo(downEngine, (repo) =>
      repo.getDeliveryMetrics({ projectId: PROJECT_ID }),
    );

    expect(result).toStrictEqual({
      downloads: 0,
      patchDownloads: 0,
      fullDownloads: 0,
      notFound: 0,
      bytesServed: 0,
      patchEligibleRequests: 0,
      unavailable: true,
    });
  });
});

describe("AnalyticsRepo.getDeliveryMetrics", () => {
  it("reports an empty dataset as available with zeros", async () => {
    const result = await runRepo(stubEngine([]), (repo) =>
      repo.getDeliveryMetrics({ projectId: PROJECT_ID }),
    );

    expect(result.unavailable).toBe(false);
    expect(result.downloads).toBe(0);
  });

  it("splits patch and full into downloads and leaves 404s out of both", async () => {
    const rows: readonly AERow[] = [
      { delivery_kind: "patch", count: "30", bytes: "3000" },
      { delivery_kind: "full", count: "10", bytes: "50000" },
      { delivery_kind: "not_found", count: "4", bytes: "0" },
    ];
    const result = await runRepo(stubEngine(rows), (repo) =>
      repo.getDeliveryMetrics({ projectId: PROJECT_ID }),
    );

    expect(result.patchDownloads).toBe(30);
    expect(result.fullDownloads).toBe(10);
    expect(result.downloads).toBe(40);
    expect(result.notFound).toBe(4);
    expect(result.bytesServed).toBe(53_000);
  });

  it("ignores a delivery kind it does not know", async () => {
    const result = await runRepo(
      stubEngine([{ delivery_kind: "future", count: "9", bytes: "9" }]),
      (repo) => repo.getDeliveryMetrics({ projectId: PROJECT_ID }),
    );

    expect(result.downloads).toBe(0);
    expect(result.bytesServed).toBe(0);
  });
});
