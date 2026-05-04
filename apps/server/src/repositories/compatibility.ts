import { Context, Effect, Layer } from "effect";
import { groupBy } from "es-toolkit";

import { cloudflareEnv } from "../cloudflare/context";
import { extractReachableBranchIds } from "../domain/branch-mapping";
import { collectServableUpdates } from "../domain/update-rollout";
import { toDbNull } from "../lib/nullable";

import type {
  BuildCompatibilityChannelModel,
  BuildCompatibilityMatrixModel,
  MissingRuntimeVersionBuildModel,
  Platform,
} from "../models";

// -- Port ------------------------------------------------------------------

export interface CompatibilityRepository {
  readonly getBuildMatrix: (params: {
    readonly projectId: string;
  }) => Effect.Effect<BuildCompatibilityMatrixModel>;
}

export class CompatibilityRepo extends Context.Tag("api/CompatibilityRepo")<
  CompatibilityRepo,
  CompatibilityRepository
>() {}

// -- D1 Adapter ------------------------------------------------------------

interface ChannelRow {
  id: string;
  name: string;
  branch_id: string;
  branch_mapping_json: string | null;
  is_paused: number;
}

interface UpdateRow {
  id: string;
  branch_id: string;
  platform: Platform;
  runtime_version: string;
  message: string;
  created_at: string;
  rollout_percentage: number;
}

const SELECT_CHANNELS = `SELECT "id", "name", "branch_id", "branch_mapping_json", "is_paused" FROM "channels" WHERE "project_id" = ? ORDER BY "name" ASC`;

const SELECT_PROJECT_UPDATES = `SELECT u."id", u."branch_id", u."platform", u."runtime_version", u."message", u."created_at", u."rollout_percentage" FROM "updates" u JOIN "branches" b ON b."id" = u."branch_id" WHERE b."project_id" = ? ORDER BY u."branch_id" ASC, u."platform" ASC, u."runtime_version" ASC, u."created_at" DESC, u."id" DESC`;

const platformRuntimeKey = (platform: Platform, runtimeVersion: string) =>
  `${platform}:${runtimeVersion}`;

interface BranchRuntimeSummary {
  readonly platform: Platform;
  readonly runtimeVersion: string;
  readonly updateCount: number;
  readonly latestUpdate: UpdateRow;
}

type ChannelRuntimeSummary = BranchRuntimeSummary;

type ChannelDefinition = ChannelRow & {
  readonly branchIds: readonly string[];
};

const groupRuntimeKey = (branchId: string, platform: Platform, runtimeVersion: string) =>
  `${branchId}:${platformRuntimeKey(platform, runtimeVersion)}`;

const compareRuntimeSummary = (left: BranchRuntimeSummary, right: BranchRuntimeSummary) =>
  left.platform.localeCompare(right.platform) ||
  left.runtimeVersion.localeCompare(right.runtimeVersion);

const isNewerUpdate = (candidate: UpdateRow, current: UpdateRow) =>
  candidate.created_at > current.created_at ||
  (candidate.created_at === current.created_at && candidate.id > current.id);

const resolveChannelBranchIds = (channel: ChannelRow) => {
  const mappingJson = channel.branch_mapping_json;
  return mappingJson === null
    ? Effect.succeed([channel.branch_id])
    : Effect.succeed(extractReachableBranchIds(mappingJson));
};

export const CompatibilityRepoLive = Layer.succeed(CompatibilityRepo, {
  getBuildMatrix: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const [buildKeysResult, channelRows, updateRows] = yield* Effect.all(
        [
          Effect.promise(async () =>
            env.DB.prepare(
              `SELECT DISTINCT "platform", "runtime_version" FROM "builds" WHERE "project_id" = ? AND "runtime_version" IS NOT NULL`,
            )
              .bind(params.projectId)
              .all<{ platform: Platform; runtime_version: string }>(),
          ),
          Effect.promise(async () =>
            env.DB.prepare(SELECT_CHANNELS).bind(params.projectId).all<ChannelRow>(),
          ),
          Effect.promise(async () =>
            env.DB.prepare(SELECT_PROJECT_UPDATES).bind(params.projectId).all<UpdateRow>(),
          ),
        ],
        { concurrency: "unbounded" },
      );

      const channelDefinitions: readonly ChannelDefinition[] = yield* Effect.all(
        channelRows.results.map((channel) =>
          Effect.map(resolveChannelBranchIds(channel), (branchIds) => ({
            ...channel,
            branchIds,
          })),
        ),
      );

      const updatesByBranchRuntime = groupBy(updateRows.results, (update) =>
        groupRuntimeKey(update.branch_id, update.platform, update.runtime_version),
      );

      const branchSummariesByBranchId = Object.values(updatesByBranchRuntime).reduce(
        (branches, updates) => {
          const [latestCandidate] = updates;
          if (!latestCandidate) {
            return branches;
          }

          const servableUpdates = collectServableUpdates(updates);
          const latestUpdate = servableUpdates.reduce<UpdateRow | null>(
            (current, candidate) =>
              current === null || isNewerUpdate(candidate, current) ? candidate : current,
            null,
          );

          if (latestUpdate === null) {
            return branches;
          }

          const existing = branches.get(latestCandidate.branch_id);
          const summary: BranchRuntimeSummary = {
            platform: latestCandidate.platform,
            runtimeVersion: latestCandidate.runtime_version,
            updateCount: servableUpdates.length,
            latestUpdate,
          };

          if (existing) {
            existing.push(summary);
          } else {
            branches.set(latestCandidate.branch_id, [summary]);
          }

          return branches;
        },
        new Map<string, BranchRuntimeSummary[]>(),
      );

      const channelSummaries = channelDefinitions.reduce((channels, channel) => {
        const summaries = channel.branchIds
          .flatMap((branchId) => branchSummariesByBranchId.get(branchId) ?? [])
          .reduce((runtimeSummaries, summary) => {
            const key = platformRuntimeKey(summary.platform, summary.runtimeVersion);
            const existing = runtimeSummaries.get(key);

            runtimeSummaries.set(
              key,
              existing
                ? {
                    platform: summary.platform,
                    runtimeVersion: summary.runtimeVersion,
                    updateCount: existing.updateCount + summary.updateCount,
                    latestUpdate: isNewerUpdate(summary.latestUpdate, existing.latestUpdate)
                      ? summary.latestUpdate
                      : existing.latestUpdate,
                  }
                : summary,
            );

            return runtimeSummaries;
          }, new Map<string, ChannelRuntimeSummary>());

        channels.set(channel.id, summaries);
        return channels;
      }, new Map<string, Map<string, ChannelRuntimeSummary>>());

      const uploadedBuildKeys = buildKeysResult.results.reduce((keys, row) => {
        keys.add(platformRuntimeKey(row.platform, row.runtime_version));
        return keys;
      }, new Set<string>());

      const channelStatusByKey: Record<string, BuildCompatibilityChannelModel[]> = {};
      uploadedBuildKeys.forEach((key) => {
        channelStatusByKey[key] = channelDefinitions.map((channel) => {
          const summary = channelSummaries.get(channel.id)?.get(key);
          return {
            channelId: channel.id,
            updateCount: summary?.updateCount ?? 0,
            latestUpdateId: toDbNull(summary?.latestUpdate.id),
            latestUpdateMessage: toDbNull(summary?.latestUpdate.message),
            latestUpdateCreatedAt: toDbNull(summary?.latestUpdate.created_at),
          } satisfies BuildCompatibilityChannelModel;
        });
      });

      return {
        channels: channelDefinitions.map((channel) => ({
          channelId: channel.id,
          channelName: channel.name,
          isPaused: channel.is_paused === 1,
          rolloutActive: channel.branch_mapping_json !== null,
        })),
        channelStatusByKey,
        missingRuntimeVersions: channelDefinitions.flatMap((channel) =>
          channel.is_paused === 1
            ? []
            : [...(channelSummaries.get(channel.id)?.values() ?? [])]
                .toSorted(compareRuntimeSummary)
                .filter(
                  (summary) =>
                    !uploadedBuildKeys.has(
                      platformRuntimeKey(summary.platform, summary.runtimeVersion),
                    ),
                )
                .map(
                  (summary) =>
                    ({
                      channelId: channel.id,
                      channelName: channel.name,
                      platform: summary.platform,
                      runtimeVersion: summary.runtimeVersion,
                      updateCount: summary.updateCount,
                      latestUpdateId: summary.latestUpdate.id,
                      latestUpdateMessage: summary.latestUpdate.message,
                      latestUpdateCreatedAt: summary.latestUpdate.created_at,
                      rolloutActive: channel.branch_mapping_json !== null,
                    }) satisfies MissingRuntimeVersionBuildModel,
                ),
        ),
      };
    }),
});
