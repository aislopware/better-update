import { Context, Effect, Layer } from "effect";

import { AnalyticsEngine } from "../cloudflare/analytics-engine";

import type {
  AnalyticsPeriod,
  ChannelAnalyticsModel,
  PlatformAnalyticsResultModel,
  UpdateAdoptionResultModel,
  UpdateAnalyticsModel,
} from "../models";

type ResponseTypeBreakdown = ChannelAnalyticsModel["responseTypeDistribution"];

const PERIOD_TO_DAYS: Record<AnalyticsPeriod, string> = {
  "1d": "1",
  "7d": "7",
  "30d": "30",
  "90d": "90",
};

const periodToDays = (period: AnalyticsPeriod | undefined): string =>
  PERIOD_TO_DAYS[period ?? "7d"];

const sanitizeLiteral = (value: string): string => value.replaceAll("'", "''");

const toNumber = (value: string | undefined): number => Number(value ?? 0);

const emptyBreakdown = (): ResponseTypeBreakdown => ({
  manifest: 0,
  directive: 0,
  noUpdate: 0,
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
}

export class AnalyticsRepo extends Context.Tag("api/AnalyticsRepo")<
  AnalyticsRepo,
  AnalyticsRepository
>() {}

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

export const AnalyticsRepoLive = Layer.effect(
  AnalyticsRepo,
  Effect.gen(function* () {
    const analytics = yield* AnalyticsEngine;

    return {
      getAdoption: (params) =>
        Effect.gen(function* () {
          const rows = yield* analytics.query(`
            SELECT
              blob4 AS updateId,
              SUM(_sample_interval) AS total_requests,
              COUNT(DISTINCT index1) AS unique_devices,
              MIN(timestamp) AS first_seen,
              MAX(timestamp) AS last_seen
            FROM update_events
            WHERE
              blob1 = '${sanitizeLiteral(params.projectId)}'
              AND blob7 = 'manifest'
              AND timestamp > NOW() - INTERVAL '${periodToDays(params.period)}' DAY
            GROUP BY blob4
            ORDER BY first_seen DESC
          `);

          return {
            updates: rows.map((row) => ({
              updateId: row["updateId"] ?? "",
              devices: toNumber(row["unique_devices"]),
              firstSeen: row["first_seen"] ?? "",
              lastSeen: row["last_seen"] ?? "",
            })),
          };
        }),

      getUpdateMetrics: (params) =>
        Effect.gen(function* () {
          const projectId = sanitizeLiteral(params.projectId);
          const updateId = sanitizeLiteral(params.updateId);
          const days = periodToDays(params.period);

          const [summaryRows, timeSeriesRows, deviceRows] = yield* Effect.all(
            [
              analytics.query(`
                SELECT blob7 AS response_type, SUM(_sample_interval) AS count
                FROM update_events
                WHERE blob1 = '${projectId}' AND blob4 = '${updateId}'
                  AND timestamp > NOW() - INTERVAL '${days}' DAY
                GROUP BY blob7
              `),
              analytics.query(`
                SELECT toStartOfHour(timestamp) AS hour, SUM(_sample_interval) AS requests
                FROM update_events
                WHERE blob1 = '${projectId}' AND blob4 = '${updateId}'
                  AND timestamp > NOW() - INTERVAL '${days}' DAY
                GROUP BY hour
                ORDER BY hour ASC
              `),
              analytics.query(`
                SELECT COUNT(DISTINCT index1) AS unique_devices
                FROM update_events
                WHERE blob1 = '${projectId}' AND blob4 = '${updateId}'
                  AND timestamp > NOW() - INTERVAL '${days}' DAY
              `),
            ],
            { concurrency: 3 },
          );

          const byResponseType = queryByResponseType(summaryRows);
          const totalRequests =
            byResponseType.manifest + byResponseType.directive + byResponseType.noUpdate;

          return {
            updateId: params.updateId,
            totalRequests,
            uniqueDevices: toNumber(deviceRows[0]?.["unique_devices"]),
            byResponseType,
            timeSeries: timeSeriesRows.map((row) => ({
              timestamp: row["hour"] ?? "",
              requests: toNumber(row["requests"]),
            })),
          };
        }),

      getChannelMetrics: (params) =>
        Effect.gen(function* () {
          const projectId = sanitizeLiteral(params.projectId);
          const channel = sanitizeLiteral(params.channel);
          const days = periodToDays(params.period);

          const [distributionRows, totalRows] = yield* Effect.all(
            [
              analytics.query(`
                SELECT blob7 AS response_type, SUM(_sample_interval) AS count
                FROM update_events
                WHERE blob1 = '${projectId}' AND blob2 = '${channel}'
                  AND timestamp > NOW() - INTERVAL '${days}' DAY
                GROUP BY blob7
              `),
              analytics.query(`
                SELECT SUM(_sample_interval) AS total_requests,
                       COUNT(DISTINCT index1) AS unique_devices
                FROM update_events
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
          };
        }),

      getPlatformMetrics: (params) =>
        Effect.gen(function* () {
          const rows = yield* analytics.query(`
            SELECT
              blob5 AS platform,
              SUM(_sample_interval) AS requests,
              COUNT(DISTINCT index1) AS unique_devices
            FROM update_events
            WHERE blob1 = '${sanitizeLiteral(params.projectId)}'
              AND timestamp > NOW() - INTERVAL '${periodToDays(params.period)}' DAY
            GROUP BY blob5
            ORDER BY requests DESC
          `);

          return {
            platforms: rows.map((row) => ({
              platform: row["platform"] ?? "",
              requests: toNumber(row["requests"]),
              devices: toNumber(row["unique_devices"]),
            })),
          };
        }),
    } satisfies AnalyticsRepository;
  }),
);
