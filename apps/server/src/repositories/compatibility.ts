import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { extractReachableBranchIds } from "../domain/branch-mapping";
import { collectServableUpdates } from "../domain/update-rollout";

import type {
  BuildCompatibilityChannelModel,
  BuildCompatibilityMatrixModel,
  BuildCompatibilityRowModel,
  MissingRuntimeVersionBuildModel,
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

interface BuildRow {
  id: string;
  project_id: string;
  platform: "ios" | "android";
  profile: string;
  distribution:
    | "app-store"
    | "ad-hoc"
    | "development"
    | "enterprise"
    | "simulator"
    | "play-store"
    | "direct";
  runtime_version: string | null;
  app_version: string | null;
  build_number: string | null;
  bundle_id: string | null;
  git_ref: string | null;
  git_commit: string | null;
  message: string | null;
  metadata_json: string;
  created_at: string;
  a_r2_key: string | null;
  a_format: "ipa" | "apk" | "aab" | "tar.gz" | null;
  a_content_type: string | null;
  a_byte_size: number | null;
  a_sha256: string | null;
}

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
  platform: "ios" | "android";
  runtime_version: string;
  message: string;
  created_at: string;
  rollout_percentage: number;
}

const SELECT_BUILDS_WITH_ARTIFACT = `SELECT b."id", b."project_id", b."platform", b."profile", b."distribution", b."runtime_version", b."app_version", b."build_number", b."bundle_id", b."git_ref", b."git_commit", b."message", b."metadata_json", b."created_at", a."r2_key" AS "a_r2_key", a."format" AS "a_format", a."content_type" AS "a_content_type", a."byte_size" AS "a_byte_size", a."sha256" AS "a_sha256" FROM "builds" b LEFT JOIN "build_artifacts" a ON a."build_id" = b."id" WHERE b."project_id" = ? ORDER BY b."created_at" DESC`;

const SELECT_CHANNELS = `SELECT "id", "name", "branch_id", "branch_mapping_json", "is_paused" FROM "channels" WHERE "project_id" = ? ORDER BY "name" ASC`;

const SELECT_PROJECT_UPDATES = `SELECT u."id", u."branch_id", u."platform", u."runtime_version", u."message", u."created_at", u."rollout_percentage" FROM "updates" u JOIN "branches" b ON b."id" = u."branch_id" WHERE b."project_id" = ? ORDER BY u."branch_id" ASC, u."platform" ASC, u."runtime_version" ASC, u."created_at" DESC, u."id" DESC`;

const toBuildRow = (row: BuildRow) => ({
  id: row.id,
  projectId: row.project_id,
  platform: row.platform,
  profile: row.profile,
  distribution: row.distribution,
  runtimeVersion: row.runtime_version,
  appVersion: row.app_version,
  buildNumber: row.build_number,
  bundleId: row.bundle_id,
  gitRef: row.git_ref,
  gitCommit: row.git_commit,
  message: row.message,
  metadataJson: row.metadata_json,
  createdAt: row.created_at,
  artifact:
    row.a_r2_key && row.a_format
      ? {
          r2Key: row.a_r2_key,
          format: row.a_format,
          contentType: row.a_content_type ?? "application/octet-stream",
          byteSize: row.a_byte_size ?? 0,
          sha256: row.a_sha256 ?? "",
        }
      : null,
});

type Platform = UpdateRow["platform"];

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

const platformRuntimeKey = (platform: Platform, runtimeVersion: string) =>
  `${platform}:${runtimeVersion}`;

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
    : Effect.orElseSucceed(
        Effect.try(() => extractReachableBranchIds(mappingJson)),
        () => [channel.branch_id],
      );
};

export const CompatibilityRepoLive = Layer.succeed(CompatibilityRepo, {
  getBuildMatrix: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const [buildRows, channelRows, updateRows] = yield* Effect.all(
        [
          Effect.promise(async () =>
            env.DB.prepare(SELECT_BUILDS_WITH_ARTIFACT).bind(params.projectId).all<BuildRow>(),
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

      const updatesByBranchRuntime = updateRows.results.reduce((groups, update) => {
        const key = groupRuntimeKey(update.branch_id, update.platform, update.runtime_version);
        const existing = groups.get(key);
        if (existing) {
          existing.push(update);
        } else {
          groups.set(key, [update]);
        }
        return groups;
      }, new Map<string, UpdateRow[]>());

      const branchSummariesByBranchId = [...updatesByBranchRuntime.values()].reduce(
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

      const uploadedBuildKeys = buildRows.results.reduce((keys, build) => {
        if (build.runtime_version !== null) {
          keys.add(platformRuntimeKey(build.platform, build.runtime_version));
        }
        return keys;
      }, new Set<string>());

      const rows = buildRows.results.map((buildRow) => {
        const build = toBuildRow(buildRow);
        const buildKey =
          build.runtimeVersion === null
            ? null
            : platformRuntimeKey(build.platform, build.runtimeVersion);

        const channelStatuses = channelDefinitions.map((channel) => {
          const summary =
            buildKey === null ? undefined : channelSummaries.get(channel.id)?.get(buildKey);

          return {
            channelId: channel.id,
            channelName: channel.name,
            updateCount: summary?.updateCount ?? 0,
            latestUpdateId: summary?.latestUpdate.id ?? null,
            latestUpdateMessage: summary?.latestUpdate.message ?? null,
            latestUpdateCreatedAt: summary?.latestUpdate.created_at ?? null,
            isPaused: channel.is_paused === 1,
            rolloutActive: channel.branch_mapping_json !== null,
          } satisfies BuildCompatibilityChannelModel;
        });

        return {
          id: build.id,
          projectId: build.projectId,
          platform: build.platform,
          profile: build.profile,
          distribution: build.distribution,
          runtimeVersion: build.runtimeVersion,
          appVersion: build.appVersion,
          buildNumber: build.buildNumber,
          bundleId: build.bundleId,
          gitRef: build.gitRef,
          gitCommit: build.gitCommit,
          message: build.message,
          metadataJson: build.metadataJson,
          createdAt: build.createdAt,
          artifact: build.artifact,
          channels: channelStatuses,
        } satisfies BuildCompatibilityRowModel;
      });

      return {
        rows,
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
