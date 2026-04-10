import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { queryAnalyticsEngine } from "../cloudflare/analytics-engine";

const sanitize = (value: string): string => value.replaceAll("'", "''");

const PERIOD_MAP: Record<string, string> = { "1d": "1", "7d": "7", "30d": "30", "90d": "90" };

const periodToDays = (period?: string): string => PERIOD_MAP[period ?? "7d"] ?? "7";

export const AnalyticsGroupLive = HttpApiBuilder.group(ManagementApi, "analytics", (handlers) =>
  handlers
    .handle("adoption", ({ urlParams: { projectId, period } }) =>
      Effect.gen(function* () {
        const pid = sanitize(projectId);
        const days = periodToDays(period);

        const rows = yield* queryAnalyticsEngine(`
          SELECT
            blob4 AS updateId,
            SUM(_sample_interval) AS total_requests,
            COUNT(DISTINCT index1) AS unique_devices,
            MIN(timestamp) AS first_seen,
            MAX(timestamp) AS last_seen
          FROM update_events
          WHERE
            blob1 = '${pid}'
            AND blob7 = 'manifest'
            AND timestamp > NOW() - INTERVAL '${days}' DAY
          GROUP BY blob4
          ORDER BY first_seen DESC
        `);

        return {
          updates: rows.map((row) => ({
            updateId: row["updateId"] ?? "",
            devices: Number(row["unique_devices"] ?? 0),
            firstSeen: row["first_seen"] ?? "",
            lastSeen: row["last_seen"] ?? "",
          })),
        };
      }),
    )
    .handle("updates", ({ urlParams: { projectId, updateId, period } }) =>
      Effect.gen(function* () {
        const pid = sanitize(projectId);
        const uid = sanitize(updateId);
        const days = periodToDays(period);

        const [summaryRows, timeSeriesRows, deviceRows] = yield* Effect.all(
          [
            queryAnalyticsEngine(`
              SELECT blob7 AS response_type, SUM(_sample_interval) AS count
              FROM update_events
              WHERE blob1 = '${pid}' AND blob4 = '${uid}'
                AND timestamp > NOW() - INTERVAL '${days}' DAY
              GROUP BY blob7
            `),
            queryAnalyticsEngine(`
              SELECT toStartOfHour(timestamp) AS hour, SUM(_sample_interval) AS requests
              FROM update_events
              WHERE blob1 = '${pid}' AND blob4 = '${uid}' AND blob7 = 'manifest'
                AND timestamp > NOW() - INTERVAL '${days}' DAY
              GROUP BY hour
              ORDER BY hour ASC
            `),
            queryAnalyticsEngine(`
              SELECT COUNT(DISTINCT index1) AS unique_devices
              FROM update_events
              WHERE blob1 = '${pid}' AND blob4 = '${uid}'
                AND timestamp > NOW() - INTERVAL '${days}' DAY
            `),
          ],
          { concurrency: 3 },
        );

        const { byType, totalRequests } = summaryRows.reduce(
          (acc, row) => {
            const count = Number(row["count"] ?? 0);
            acc.byType[row["response_type"] ?? ""] = count;
            return { byType: acc.byType, totalRequests: acc.totalRequests + count };
          },
          { byType: {} as Record<string, number>, totalRequests: 0 },
        );

        return {
          updateId,
          totalRequests,
          uniqueDevices: Number(deviceRows[0]?.["unique_devices"] ?? 0),
          byResponseType: {
            manifest: byType["manifest"] ?? 0,
            directive: byType["directive"] ?? 0,
            no_update: byType["no_update"] ?? 0,
          },
          timeSeries: timeSeriesRows.map((row) => ({
            timestamp: row["hour"] ?? "",
            requests: Number(row["requests"] ?? 0),
          })),
        };
      }),
    )
    .handle("channels", ({ urlParams: { projectId, channel, period } }) =>
      Effect.gen(function* () {
        const pid = sanitize(projectId);
        const ch = sanitize(channel);
        const days = periodToDays(period);

        const [distRows, totalsRows] = yield* Effect.all(
          [
            queryAnalyticsEngine(`
              SELECT blob7 AS response_type, SUM(_sample_interval) AS count
              FROM update_events
              WHERE blob1 = '${pid}' AND blob2 = '${ch}'
                AND timestamp > NOW() - INTERVAL '${days}' DAY
              GROUP BY blob7
            `),
            queryAnalyticsEngine(`
              SELECT SUM(_sample_interval) AS total_requests,
                     COUNT(DISTINCT index1) AS unique_devices
              FROM update_events
              WHERE blob1 = '${pid}' AND blob2 = '${ch}'
                AND timestamp > NOW() - INTERVAL '${days}' DAY
            `),
          ],
          { concurrency: 2 },
        );

        const dist = distRows.reduce<Record<string, number>>((acc, row) => {
          acc[row["response_type"] ?? ""] = Number(row["count"] ?? 0);
          return acc;
        }, {});

        return {
          channel,
          totalRequests: Number(totalsRows[0]?.["total_requests"] ?? 0),
          uniqueDevices: Number(totalsRows[0]?.["unique_devices"] ?? 0),
          responseTypeDistribution: {
            manifest: dist["manifest"] ?? 0,
            directive: dist["directive"] ?? 0,
            no_update: dist["no_update"] ?? 0,
          },
        };
      }),
    )
    .handle("platforms", ({ urlParams: { projectId, period } }) =>
      Effect.gen(function* () {
        const pid = sanitize(projectId);
        const days = periodToDays(period);

        const rows = yield* queryAnalyticsEngine(`
          SELECT
            blob5 AS platform,
            SUM(_sample_interval) AS requests,
            COUNT(DISTINCT index1) AS unique_devices
          FROM update_events
          WHERE blob1 = '${pid}'
            AND timestamp > NOW() - INTERVAL '${days}' DAY
          GROUP BY blob5
          ORDER BY requests DESC
        `);

        return {
          platforms: rows.map((row) => ({
            platform: row["platform"] ?? "",
            requests: Number(row["requests"] ?? 0),
            devices: Number(row["unique_devices"] ?? 0),
          })),
        };
      }),
    ),
);
