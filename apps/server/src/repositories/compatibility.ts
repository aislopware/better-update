import { Context, Effect, Layer } from "effect";
import { groupBy } from "es-toolkit";

import { kyselyDb } from "../cloudflare/db";
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
  // Always union the channel's default branch_id (its EAS-convention served
  // fallback) so a branch that is actually being served is never dropped from
  // the matrix — mirrors the reaper's backstop in
  // channels.listReachableBranchIdsByProject.
  return mappingJson === null
    ? Effect.succeed([channel.branch_id])
    : Effect.succeed([...new Set([channel.branch_id, ...extractReachableBranchIds(mappingJson)])]);
};

export const CompatibilityRepoLive = Layer.succeed(CompatibilityRepo, {
  getBuildMatrix: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const [buildKeys, channelRows, updateRows] = yield* Effect.all(
        [
          Effect.promise(async () =>
            // platform is always "ios"|"android"; runtime_version IS NOT NULL filter
            // makes it non-nullable at runtime despite the nullable schema column
            db
              .selectFrom("builds")
              .select(["platform", "runtime_version"])
              .distinct()
              .where("project_id", "=", params.projectId)
              .where("runtime_version", "is not", null)
              .$narrowType<{ runtime_version: string }>()
              .execute(),
          ),
          Effect.promise(async () =>
            db
              .selectFrom("channels")
              .select(["id", "name", "branch_id", "branch_mapping_json", "is_paused"])
              .where("project_id", "=", params.projectId)
              .orderBy("name", "asc")
              .execute(),
          ),
          Effect.promise(async () =>
            // platform is always "ios"|"android" in the DB
            db
              .selectFrom("updates as u")
              .innerJoin("branches as b", "b.id", "u.branch_id")
              .select([
                "u.id",
                "u.branch_id",
                "u.platform",
                "u.runtime_version",
                "u.message",
                "u.created_at",
                "u.rollout_percentage",
              ])
              .where("b.project_id", "=", params.projectId)
              .orderBy("u.branch_id", "asc")
              .orderBy("u.platform", "asc")
              .orderBy("u.runtime_version", "asc")
              .orderBy("u.created_at", "desc")
              .orderBy("u.id", "desc")
              .execute(),
          ),
        ],
        { concurrency: "unbounded" },
      );

      const channelDefinitions: readonly ChannelDefinition[] = yield* Effect.all(
        channelRows.map((channel) =>
          Effect.map(resolveChannelBranchIds(channel), (branchIds) => ({
            ...channel,
            branchIds,
          })),
        ),
      );

      const updatesByBranchRuntime = groupBy(updateRows, (update) =>
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

      const uploadedBuildKeys = buildKeys.reduce((keys, row) => {
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
