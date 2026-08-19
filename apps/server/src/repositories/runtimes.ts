import { Context, Effect, Layer } from "effect";

import { kyselyDb } from "../cloudflare/db";

import type { Platform } from "../models";

// -- Port ------------------------------------------------------------------

export interface RuntimeAggregateModel {
  readonly version: string;
  readonly platforms: readonly Platform[];
  readonly buildsCount: number;
  readonly updatesCount: number;
  readonly latestActivity: string;
}

export interface RuntimeRepository {
  readonly findByProject: (params: {
    readonly projectId: string;
    readonly limit: number;
    readonly offset: number;
  }) => Effect.Effect<{ readonly items: readonly RuntimeAggregateModel[]; readonly total: number }>;
}

export class RuntimeRepo extends Context.Service<RuntimeRepo, RuntimeRepository>()(
  "api/RuntimeRepo",
) {}

// -- D1 Adapter ------------------------------------------------------------

interface RuntimeBucket {
  readonly platforms: readonly Platform[];
  readonly buildsCount: number;
  readonly updatesCount: number;
  readonly latestActivity: string;
}

const EMPTY_BUCKET: RuntimeBucket = {
  platforms: [],
  buildsCount: 0,
  updatesCount: 0,
  latestActivity: "",
};

// Fixed order so a row reads the same way every time, whichever platform the
// project happened to publish first.
const PLATFORM_ORDER: readonly Platform[] = ["ios", "android"];

const newerOf = (left: string, right: string): string => (left >= right ? left : right);

interface RuntimeGroupRow {
  readonly version: string;
  readonly platform: Platform;
  readonly count: number;
  readonly latest: string;
}

/**
 * Fold one `(runtime version, platform)` group into the per-version bucket.
 * Builds and updates are counted separately but share the platform set and the
 * latest-activity high-water mark.
 */
const mergeGroup = (
  buckets: ReadonlyMap<string, RuntimeBucket>,
  row: RuntimeGroupRow,
  counts: "builds" | "updates",
): ReadonlyMap<string, RuntimeBucket> => {
  const existing = buckets.get(row.version) ?? EMPTY_BUCKET;
  return new Map(buckets).set(row.version, {
    platforms: existing.platforms.includes(row.platform)
      ? existing.platforms
      : PLATFORM_ORDER.filter(
          (platform) => platform === row.platform || existing.platforms.includes(platform),
        ),
    buildsCount: existing.buildsCount + (counts === "builds" ? row.count : 0),
    updatesCount: existing.updatesCount + (counts === "updates" ? row.count : 0),
    latestActivity: existing.latestActivity
      ? newerOf(existing.latestActivity, row.latest)
      : row.latest,
  });
};

export const RuntimeRepoLive = Layer.succeed(RuntimeRepo, {
  // Two GROUP BY queries (builds and updates) merged per version. Runtime-version
  // cardinality is bounded by the project's release history, so the merged map is
  // small even when the underlying builds/updates tables are not.
  findByProject: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const [buildRows, updateRows] = yield* Effect.promise(async () =>
        Promise.all([
          db
            .selectFrom("builds")
            .select((eb) => [
              "runtime_version",
              "platform",
              eb.fn.countAll<number>().as("count"),
              eb.fn.max("created_at").as("latest"),
            ])
            .where("project_id", "=", params.projectId)
            // Non-Expo builds carry no runtime version and have no OTA runtime row.
            .where("runtime_version", "is not", null)
            .groupBy(["runtime_version", "platform"])
            .execute(),
          db
            .selectFrom("updates")
            .select((eb) => [
              "runtime_version",
              "platform",
              eb.fn.countAll<number>().as("count"),
              eb.fn.max("created_at").as("latest"),
            ])
            .where(
              "branch_id",
              "in",
              db.selectFrom("branches").select("id").where("project_id", "=", params.projectId),
            )
            .groupBy(["runtime_version", "platform"])
            .execute(),
        ]),
      );

      const fromBuilds = buildRows.reduce<ReadonlyMap<string, RuntimeBucket>>(
        (buckets, row) =>
          row.runtime_version === null
            ? buckets
            : mergeGroup(
                buckets,
                {
                  version: row.runtime_version,
                  platform: row.platform,
                  count: row.count,
                  latest: row.latest,
                },
                "builds",
              ),
        new Map<string, RuntimeBucket>(),
      );
      const buckets = updateRows.reduce<ReadonlyMap<string, RuntimeBucket>>(
        (merged, row) =>
          mergeGroup(
            merged,
            {
              version: row.runtime_version,
              platform: row.platform,
              count: row.count,
              latest: row.latest,
            },
            "updates",
          ),
        fromBuilds,
      );

      const items = Array.from(buckets, ([version, bucket]) => ({ version, ...bucket })).toSorted(
        (left, right) =>
          right.latestActivity.localeCompare(left.latestActivity) ||
          right.version.localeCompare(left.version),
      );

      return {
        items: items.slice(params.offset, params.offset + params.limit),
        total: items.length,
      };
    }),
});
