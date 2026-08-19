import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { ManagementApi } from "../api";
import { CurrentActor } from "../auth/current-actor";
import { assertProjectOwnership } from "../auth/ownership";
import { assertAccess } from "../auth/policy";
import {
  densifyActivity,
  groupProjectActivity,
  periodStart,
  toDayKey,
} from "../domain/activity-series";
import { ActivityRepo, AnalyticsRepo } from "../repositories";

export const AnalyticsGroupLive = HttpApiBuilder.group(ManagementApi, "analytics", (handlers) =>
  handlers
    .handle("adoption", ({ query: { projectId, period } }) =>
      Effect.gen(function* () {
        yield* assertProjectOwnership(projectId);
        yield* assertAccess("project", "read", { kind: "project", projectId });
        const repo = yield* AnalyticsRepo;

        const result = yield* repo.getAdoption({ projectId, period });

        return {
          updates: result.updates.map((update) => ({
            updateId: update.updateId,
            devices: update.devices,
            firstSeen: update.firstSeen,
            lastSeen: update.lastSeen,
          })),
          unavailable: result.unavailable,
        };
      }),
    )
    .handle("updates", ({ query: { projectId, updateId, period } }) =>
      Effect.gen(function* () {
        yield* assertProjectOwnership(projectId);
        yield* assertAccess("project", "read", { kind: "project", projectId });
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
          unavailable: result.unavailable,
        };
      }),
    )
    .handle("channels", ({ query: { projectId, channel, period } }) =>
      Effect.gen(function* () {
        yield* assertProjectOwnership(projectId);
        yield* assertAccess("project", "read", { kind: "project", projectId });
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
          unavailable: result.unavailable,
        };
      }),
    )
    .handle("platforms", ({ query: { projectId, period } }) =>
      Effect.gen(function* () {
        yield* assertProjectOwnership(projectId);
        yield* assertAccess("project", "read", { kind: "project", projectId });
        const repo = yield* AnalyticsRepo;
        const result = yield* repo.getPlatformMetrics({ projectId, period });

        return {
          platforms: result.platforms.map((platform) => ({
            platform: platform.platform,
            requests: platform.requests,
            devices: platform.devices,
          })),
          unavailable: result.unavailable,
        };
      }),
    )
    .handle("downloads", ({ query: { projectId, period } }) =>
      Effect.gen(function* () {
        yield* assertProjectOwnership(projectId);
        yield* assertAccess("project", "read", { kind: "project", projectId });
        const repo = yield* AnalyticsRepo;
        const result = yield* repo.getDeliveryMetrics({ projectId, period });

        return {
          downloads: result.downloads,
          patchDownloads: result.patchDownloads,
          fullDownloads: result.fullDownloads,
          notFound: result.notFound,
          bytesServed: result.bytesServed,
          patchEligibleRequests: result.patchEligibleRequests,
          unavailable: result.unavailable,
        };
      }),
    )
    .handle("activity", ({ query: { projectId, period } }) =>
      Effect.gen(function* () {
        const ctx = yield* CurrentActor;
        if (projectId !== undefined) {
          yield* assertProjectOwnership(projectId);
          yield* assertAccess("project", "read", { kind: "project", projectId });
        }
        // GitLab-style visibility (GITLAB-RBAC-SPEC §1), same rule the project
        // list runs: owner/admin count the whole organization, a plain member
        // counts only the projects they hold a membership row on. Asking for one
        // project has already been authorized above, so the list is moot there.
        const seesAll = ctx.isOwner || ctx.isSuperadmin || ctx.orgRole === "admin";
        const visibleProjectIds =
          seesAll || projectId !== undefined ? undefined : Object.keys(ctx.projectRoles);

        const repo = yield* ActivityRepo;
        const now = new Date();
        const rows = yield* repo.getDailyCounts({
          organizationId: ctx.organizationId,
          ...(projectId === undefined ? {} : { projectId }),
          ...(visibleProjectIds === undefined ? {} : { visibleProjectIds }),
          since: toDayKey(periodStart(now, period)),
        });

        const series = densifyActivity(rows, now, period);

        return {
          series,
          totalUpdates: series.reduce((sum, point) => sum + point.updates, 0),
          totalBuilds: series.reduce((sum, point) => sum + point.builds, 0),
        };
      }),
    )
    .handle("projectActivity", ({ query: { projectIds, period } }) =>
      Effect.gen(function* () {
        const ctx = yield* CurrentActor;
        // No per-project authorization pass: `projectIds` narrows within what
        // the visibility rule already allows, and the organization filter in the
        // repository is what stops an id from another org resolving at all. The
        // same rule the ungrouped endpoint runs, told apart by project.
        const seesAll = ctx.isOwner || ctx.isSuperadmin || ctx.orgRole === "admin";
        const visibleProjectIds = seesAll ? undefined : Object.keys(ctx.projectRoles);

        const repo = yield* ActivityRepo;
        const now = new Date();
        const rows = yield* repo.getDailyCountsByProject({
          organizationId: ctx.organizationId,
          ...(projectIds === undefined ? {} : { projectIds }),
          ...(visibleProjectIds === undefined ? {} : { visibleProjectIds }),
          since: toDayKey(periodStart(now, period)),
        });

        return { projects: groupProjectActivity(rows, now, period) };
      }),
    ),
);
