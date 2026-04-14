import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { AnalyticsRepo } from "../repositories";

export const AnalyticsGroupLive = HttpApiBuilder.group(ManagementApi, "analytics", (handlers) =>
  handlers
    .handle("adoption", ({ urlParams: { projectId, period } }) =>
      Effect.gen(function* () {
        yield* assertPermission("project", "read");
        yield* assertProjectOwnership(projectId);
        const repo = yield* AnalyticsRepo;

        const result = yield* repo.getAdoption({ projectId, period });

        return {
          updates: result.updates.map((update) => ({
            updateId: update.updateId,
            devices: update.devices,
            firstSeen: update.firstSeen,
            lastSeen: update.lastSeen,
          })),
        };
      }),
    )
    .handle("updates", ({ urlParams: { projectId, updateId, period } }) =>
      Effect.gen(function* () {
        yield* assertPermission("project", "read");
        yield* assertProjectOwnership(projectId);
        const repo = yield* AnalyticsRepo;
        const result = yield* repo.getUpdateMetrics({ projectId, updateId, period });

        return {
          updateId: result.updateId,
          totalRequests: result.totalRequests,
          uniqueDevices: result.uniqueDevices,
          byResponseType: {
            manifest: result.byResponseType.manifest,
            directive: result.byResponseType.directive,
            no_update: result.byResponseType.noUpdate,
          },
          timeSeries: result.timeSeries.map((entry) => ({
            timestamp: entry.timestamp,
            requests: entry.requests,
          })),
        };
      }),
    )
    .handle("channels", ({ urlParams: { projectId, channel, period } }) =>
      Effect.gen(function* () {
        yield* assertPermission("project", "read");
        yield* assertProjectOwnership(projectId);
        const repo = yield* AnalyticsRepo;
        const result = yield* repo.getChannelMetrics({ projectId, channel, period });

        return {
          channel: result.channel,
          totalRequests: result.totalRequests,
          uniqueDevices: result.uniqueDevices,
          responseTypeDistribution: {
            manifest: result.responseTypeDistribution.manifest,
            directive: result.responseTypeDistribution.directive,
            no_update: result.responseTypeDistribution.noUpdate,
          },
        };
      }),
    )
    .handle("platforms", ({ urlParams: { projectId, period } }) =>
      Effect.gen(function* () {
        yield* assertPermission("project", "read");
        yield* assertProjectOwnership(projectId);
        const repo = yield* AnalyticsRepo;
        const result = yield* repo.getPlatformMetrics({ projectId, period });

        return {
          platforms: result.platforms.map((platform) => ({
            platform: platform.platform,
            requests: platform.requests,
            devices: platform.devices,
          })),
        };
      }),
    ),
);
