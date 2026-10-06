import { Context, Effect, Layer } from "effect";

import { AnalyticsEngine } from "../cloudflare/analytics-engine";
import { DataIntegrityError } from "../lib/require-value";

import type {
  ChannelAnalyticsModel,
  DeliveryAnalyticsModel,
  DesktopAnalyticsModel,
  PlatformAnalyticsResultModel,
  UpdateAdoptionResultModel,
  UpdateAnalyticsModel,
} from "../analytics-models";
import type {
  AERow,
  AnalyticsEngineClient,
  AnalyticsUnavailable,
} from "../cloudflare/analytics-engine";
import type { AnalyticsPeriod } from "../models";

type ResponseTypeBreakdown = ChannelAnalyticsModel["responseTypeDistribution"];

const PERIOD_TO_DAYS: Record<AnalyticsPeriod, string> = {
  "1d": "1",
  "7d": "7",
  "30d": "30",
  "90d": "90",
};

const periodToDays = (period: AnalyticsPeriod | undefined): string =>
  PERIOD_TO_DAYS[period ?? "7d"];

const UUID_RE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;
const CHANNEL_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/u;

const sanitizeUuid = (value: string): string => (UUID_RE.test(value) ? value : "");

const sanitizeChannelName = (value: string): string =>
  CHANNEL_NAME_RE.test(value) ? value.replaceAll("'", "''") : "";

const toNumber = (value: string | undefined): number => Number(value ?? 0);

const emptyBreakdown = (): ResponseTypeBreakdown => ({
  manifest: 0,
  directive: 0,
  noUpdate: 0,
});

/**
 * Degrade an unreachable Analytics Engine to an empty result FLAGGED as such.
 *
 * Analytics must never fail the dashboard: a project page still lists its
 * channels, branches and updates when telemetry is down. But the caller has to
 * be able to tell "nothing to show" from "could not ask" — so the fallback is
 * the empty shape with `unavailable: true`, not a bare empty shape.
 */
const orUnavailable =
  <Result>(fallback: Result) =>
  (effect: Effect.Effect<Result, AnalyticsUnavailable>): Effect.Effect<Result> =>
    Effect.catchTag(effect, "AnalyticsUnavailable", () => Effect.succeed(fallback));

// The `unavailable: true` shapes, typed as their model so the fallback and the
// success path agree — an inline literal would infer `updates: never[]` and
// refuse to unify with the rows the query returns.
const UNAVAILABLE_ADOPTION: UpdateAdoptionResultModel = { updates: [], unavailable: true };

const UNAVAILABLE_PLATFORMS: PlatformAnalyticsResultModel = { platforms: [], unavailable: true };

const unavailableUpdate = (updateId: string): UpdateAnalyticsModel => ({
  updateId,
  totalRequests: 0,
  uniqueDevices: 0,
  byResponseType: emptyBreakdown(),
  timeSeries: [],
  unavailable: true,
});

const unavailableChannel = (channel: string): ChannelAnalyticsModel => ({
  channel,
  totalRequests: 0,
  uniqueDevices: 0,
  responseTypeDistribution: emptyBreakdown(),
  unavailable: true,
});

export interface AnalyticsRepository {
  readonly getAdoption: (params: {
    readonly projectId: string;
    readonly period?: AnalyticsPeriod | undefined;
  }) => Effect.Effect<UpdateAdoptionResultModel>;

  readonly getUpdateMetrics: (params: {
    readonly projectId: string;
    readonly updateId: string;
    readonly period?: AnalyticsPeriod | undefined;
  }) => Effect.Effect<UpdateAnalyticsModel>;

  readonly getChannelMetrics: (params: {
    readonly projectId: string;
    readonly channel: string;
    readonly period?: AnalyticsPeriod | undefined;
  }) => Effect.Effect<ChannelAnalyticsModel>;

  readonly getPlatformMetrics: (params: {
    readonly projectId: string;
    readonly period?: AnalyticsPeriod | undefined;
  }) => Effect.Effect<PlatformAnalyticsResultModel>;

  readonly getDeliveryMetrics: (params: {
    readonly projectId: string;
    readonly period?: AnalyticsPeriod | undefined;
  }) => Effect.Effect<DeliveryAnalyticsModel>;

  readonly getDesktopMetrics: (params: {
    readonly projectId: string;
    readonly period?: AnalyticsPeriod | undefined;
  }) => Effect.Effect<DesktopAnalyticsModel>;
}

const UNAVAILABLE_DESKTOP: DesktopAnalyticsModel = {
  checks: 0,
  installs: 0,
  updaters: [],
  clientVersions: [],
  releases: [],
  unavailable: true,
};

/** Versions listed: the long tail of old installs is one row each and says little. */
const CLIENT_VERSION_LIMIT = 20;

/** Per release: whole-file downloads counted, every transfer's bytes summed. */
const releaseDownloads = (rows: readonly AERow[]): DesktopAnalyticsModel["releases"] =>
  [
    ...rows
      .reduce((byRelease, row) => {
        const releaseId = row["release_id"];
        if (releaseId === undefined || releaseId === "") {
          return byRelease;
        }
        const previous = byRelease.get(releaseId) ?? { releaseId, downloads: 0, bytes: 0 };
        return byRelease.set(releaseId, {
          releaseId,
          downloads: previous.downloads + (row["transfer"] === "full" ? toNumber(row["count"]) : 0),
          bytes: previous.bytes + toNumber(row["bytes"]),
        });
      }, new Map<string, DesktopAnalyticsModel["releases"][number]>())
      .values(),
  ].toSorted((left, right) => right.downloads - left.downloads || right.bytes - left.bytes);

const EMPTY_DELIVERY: DeliveryAnalyticsModel = {
  downloads: 0,
  patchDownloads: 0,
  fullDownloads: 0,
  notFound: 0,
  bytesServed: 0,
  patchEligibleRequests: 0,
  unavailable: false,
};

const UNAVAILABLE_DELIVERY: DeliveryAnalyticsModel = { ...EMPTY_DELIVERY, unavailable: true };

export class AnalyticsRepo extends Context.Service<AnalyticsRepo, AnalyticsRepository>()(
  "api/AnalyticsRepo",
) {}

const requireBlob = (value: string | undefined, source: string, field: string) =>
  value === undefined || value === ""
    ? Effect.die(new DataIntegrityError({ source, field }))
    : Effect.succeed(value);

const queryByResponseType = (rows: readonly Record<string, string>[]): ResponseTypeBreakdown =>
  rows.reduce((breakdown, row) => {
    const responseType = row["response_type"];
    const count = toNumber(row["count"]);

    if (responseType === "manifest") {
      return { ...breakdown, manifest: count };
    }

    if (responseType === "directive") {
      return { ...breakdown, directive: count };
    }

    if (responseType === "no_update") {
      return { ...breakdown, noUpdate: count };
    }

    return breakdown;
  }, emptyBreakdown());

/** Desktop feed checks per updater and version, and what each release sent. */
const desktopMetrics =
  (analytics: AnalyticsEngineClient) =>
  (params: { readonly projectId: string; readonly period?: AnalyticsPeriod | undefined }) =>
    Effect.gen(function* () {
      const { desktop } = yield* analytics.datasets;
      const projectId = sanitizeUuid(params.projectId);
      const window = `blob1 = '${projectId}'
              AND timestamp > NOW() - INTERVAL '${periodToDays(params.period)}' DAY`;
      const [updaterRows, installRows, versionRows, downloadRows] = yield* Effect.all(
        [
          analytics.query(`
            SELECT blob3 AS platform, blob4 AS updater, SUM(_sample_interval) AS checks
            FROM ${desktop}
            WHERE ${window} AND blob2 = 'check'
            GROUP BY blob3, blob4
            ORDER BY checks DESC
          `),
          // A check without an install id indexes as "<project>:" — one
          // shared bucket that is not an install.
          analytics.query(`
            SELECT COUNT(DISTINCT index1) AS installs
            FROM ${desktop}
            WHERE ${window} AND blob2 = 'check' AND index1 != '${projectId}:'
          `),
          analytics.query(`
            SELECT blob3 AS platform, blob9 AS version, SUM(_sample_interval) AS checks
            FROM ${desktop}
            WHERE ${window} AND blob2 = 'check' AND blob9 != ''
            GROUP BY blob3, blob9
            ORDER BY checks DESC
            LIMIT ${String(CLIENT_VERSION_LIMIT)}
          `),
          analytics.query(`
            SELECT blob7 AS release_id, blob5 AS transfer,
                   SUM(_sample_interval) AS count,
                   SUM(double1 * _sample_interval) AS bytes
            FROM ${desktop}
            WHERE ${window} AND blob2 = 'download'
            GROUP BY blob7, blob5
          `),
        ],
        { concurrency: 4 },
      );
      const updaters = updaterRows.map((row) => ({
        platform: row["platform"] ?? "unknown",
        updater: row["updater"] ?? "unknown",
        checks: toNumber(row["checks"]),
      }));
      return {
        checks: updaters.reduce((total, row) => total + row.checks, 0),
        installs: toNumber(installRows[0]?.["installs"]),
        updaters,
        clientVersions: versionRows.map((row) => ({
          platform: row["platform"] ?? "unknown",
          version: row["version"] ?? "unknown",
          checks: toNumber(row["checks"]),
        })),
        releases: releaseDownloads(downloadRows),
        unavailable: false,
      };
    }).pipe(orUnavailable(UNAVAILABLE_DESKTOP));

export const AnalyticsRepoLive = Layer.effect(
  AnalyticsRepo,
  Effect.gen(function* () {
    const analytics = yield* AnalyticsEngine;

    return {
      getAdoption: (params) =>
        Effect.gen(function* () {
          const datasets = yield* analytics.datasets;
          const rows = yield* analytics.query(`
            SELECT
              blob4 AS updateId,
              SUM(_sample_interval) AS total_requests,
              COUNT(DISTINCT index1) AS unique_devices,
              MIN(timestamp) AS first_seen,
              MAX(timestamp) AS last_seen
            FROM ${datasets.updates}
            WHERE
              blob1 = '${sanitizeUuid(params.projectId)}'
              AND blob7 = 'manifest'
              AND timestamp > NOW() - INTERVAL '${periodToDays(params.period)}' DAY
            GROUP BY blob4
            ORDER BY first_seen DESC
          `);

          // eslint-disable-next-line unicorn/no-array-method-this-argument -- Effect.forEach, not Array.forEach
          const updates = yield* Effect.forEach(rows, (row) =>
            Effect.gen(function* () {
              const updateId = yield* requireBlob(
                row["updateId"],
                "analytics.getAdoption",
                "updateId",
              );
              const firstSeen = yield* requireBlob(
                row["first_seen"],
                "analytics.getAdoption",
                "first_seen",
              );
              const lastSeen = yield* requireBlob(
                row["last_seen"],
                "analytics.getAdoption",
                "last_seen",
              );
              return {
                updateId,
                devices: toNumber(row["unique_devices"]),
                firstSeen,
                lastSeen,
              };
            }),
          );
          return { updates, unavailable: false };
        }).pipe(orUnavailable(UNAVAILABLE_ADOPTION)),

      getUpdateMetrics: (params) =>
        Effect.gen(function* () {
          const datasets = yield* analytics.datasets;
          const projectId = sanitizeUuid(params.projectId);
          const updateId = sanitizeUuid(params.updateId);
          const days = periodToDays(params.period);

          const [summaryRows, timeSeriesRows, deviceRows] = yield* Effect.all(
            [
              analytics.query(`
                SELECT blob7 AS response_type, SUM(_sample_interval) AS count
                FROM ${datasets.updates}
                WHERE blob1 = '${projectId}' AND blob4 = '${updateId}'
                  AND timestamp > NOW() - INTERVAL '${days}' DAY
                GROUP BY blob7
              `),
              analytics.query(`
                SELECT toStartOfHour(timestamp) AS hour, SUM(_sample_interval) AS requests
                FROM ${datasets.updates}
                WHERE blob1 = '${projectId}' AND blob4 = '${updateId}'
                  AND timestamp > NOW() - INTERVAL '${days}' DAY
                GROUP BY hour
                ORDER BY hour ASC
              `),
              analytics.query(`
                SELECT COUNT(DISTINCT index1) AS unique_devices
                FROM ${datasets.updates}
                WHERE blob1 = '${projectId}' AND blob4 = '${updateId}'
                  AND timestamp > NOW() - INTERVAL '${days}' DAY
              `),
            ],
            { concurrency: 3 },
          );

          const byResponseType = queryByResponseType(summaryRows);
          const totalRequests =
            byResponseType.manifest + byResponseType.directive + byResponseType.noUpdate;

          // eslint-disable-next-line unicorn/no-array-method-this-argument -- Effect.forEach, not Array.forEach
          const timeSeries = yield* Effect.forEach(timeSeriesRows, (row) =>
            Effect.gen(function* () {
              const timestamp = yield* requireBlob(
                row["hour"],
                "analytics.getUpdateMetrics",
                "hour",
              );
              return { timestamp, requests: toNumber(row["requests"]) };
            }),
          );
          return {
            updateId: params.updateId,
            totalRequests,
            uniqueDevices: toNumber(deviceRows[0]?.["unique_devices"]),
            byResponseType,
            timeSeries,
            unavailable: false,
          };
        }).pipe(orUnavailable(unavailableUpdate(params.updateId))),

      getChannelMetrics: (params) =>
        Effect.gen(function* () {
          const datasets = yield* analytics.datasets;
          const projectId = sanitizeUuid(params.projectId);
          const channel = sanitizeChannelName(params.channel);
          const days = periodToDays(params.period);

          const [distributionRows, totalRows] = yield* Effect.all(
            [
              analytics.query(`
                SELECT blob7 AS response_type, SUM(_sample_interval) AS count
                FROM ${datasets.updates}
                WHERE blob1 = '${projectId}' AND blob2 = '${channel}'
                  AND timestamp > NOW() - INTERVAL '${days}' DAY
                GROUP BY blob7
              `),
              analytics.query(`
                SELECT SUM(_sample_interval) AS total_requests,
                       COUNT(DISTINCT index1) AS unique_devices
                FROM ${datasets.updates}
                WHERE blob1 = '${projectId}' AND blob2 = '${channel}'
                  AND timestamp > NOW() - INTERVAL '${days}' DAY
              `),
            ],
            { concurrency: 2 },
          );

          return {
            channel: params.channel,
            totalRequests: toNumber(totalRows[0]?.["total_requests"]),
            uniqueDevices: toNumber(totalRows[0]?.["unique_devices"]),
            responseTypeDistribution: queryByResponseType(distributionRows),
            unavailable: false,
          };
        }).pipe(orUnavailable(unavailableChannel(params.channel))),

      getPlatformMetrics: (params) =>
        Effect.gen(function* () {
          const datasets = yield* analytics.datasets;
          const rows = yield* analytics.query(`
            SELECT
              blob5 AS platform,
              SUM(_sample_interval) AS requests,
              COUNT(DISTINCT index1) AS unique_devices
            FROM ${datasets.updates}
            WHERE blob1 = '${sanitizeUuid(params.projectId)}'
              AND timestamp > NOW() - INTERVAL '${periodToDays(params.period)}' DAY
            GROUP BY blob5
            ORDER BY requests DESC
          `);

          // eslint-disable-next-line unicorn/no-array-method-this-argument -- Effect.forEach, not Array.forEach
          const platforms = yield* Effect.forEach(rows, (row) =>
            Effect.gen(function* () {
              const platform = yield* requireBlob(
                row["platform"],
                "analytics.getPlatformMetrics",
                "platform",
              );
              return {
                platform,
                requests: toNumber(row["requests"]),
                devices: toNumber(row["unique_devices"]),
              };
            }),
          );
          return { platforms, unavailable: false };
        }).pipe(orUnavailable(UNAVAILABLE_PLATFORMS)),

      getDeliveryMetrics: (params) =>
        Effect.gen(function* () {
          const datasets = yield* analytics.datasets;
          const projectId = sanitizeUuid(params.projectId);
          const days = periodToDays(params.period);

          const [kindRows, eligibleRows] = yield* Effect.all(
            [
              analytics.query(`
                SELECT
                  blob4 AS delivery_kind,
                  SUM(_sample_interval) AS count,
                  SUM(double1 * _sample_interval) AS bytes
                FROM ${datasets.deliveries}
                WHERE blob1 = '${projectId}'
                  AND timestamp > NOW() - INTERVAL '${days}' DAY
                GROUP BY blob4
              `),
              analytics.query(`
                SELECT SUM(_sample_interval) AS eligible
                FROM ${datasets.deliveries}
                WHERE blob1 = '${projectId}' AND blob7 = '1'
                  AND timestamp > NOW() - INTERVAL '${days}' DAY
              `),
            ],
            { concurrency: 2 },
          );

          return kindRows.reduce<DeliveryAnalyticsModel>(
            (totals, row) => {
              const count = toNumber(row["count"]);
              const bytes = toNumber(row["bytes"]);
              const kind = row["delivery_kind"];
              // A 404 sent no body, so it counts as neither a download nor
              // bytes — only as the miss it is.
              if (kind === "not_found") {
                return { ...totals, notFound: totals.notFound + count };
              }
              if (kind !== "patch" && kind !== "full") {
                return totals;
              }
              const served = {
                ...totals,
                downloads: totals.downloads + count,
                bytesServed: totals.bytesServed + bytes,
              };
              return kind === "patch"
                ? { ...served, patchDownloads: served.patchDownloads + count }
                : { ...served, fullDownloads: served.fullDownloads + count };
            },
            {
              ...EMPTY_DELIVERY,
              patchEligibleRequests: toNumber(eligibleRows[0]?.["eligible"]),
            },
          );
        }).pipe(orUnavailable(UNAVAILABLE_DELIVERY)),

      getDesktopMetrics: desktopMetrics(analytics),
    } satisfies AnalyticsRepository;
  }),
);
