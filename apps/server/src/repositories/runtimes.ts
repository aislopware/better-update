import { Context, Effect, Layer } from "effect";

import { kyselyDb } from "../cloudflare/db";

// -- Port ------------------------------------------------------------------

export interface RuntimeAggregateModel {
  readonly version: string;
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

export class RuntimeRepo extends Context.Tag("api/RuntimeRepo")<RuntimeRepo, RuntimeRepository>() {}

// -- D1 Adapter ------------------------------------------------------------

interface RuntimeBucket {
  readonly buildsCount: number;
  readonly updatesCount: number;
  readonly latestActivity: string;
}

const newerOf = (left: string, right: string): string => (left >= right ? left : right);

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
              eb.fn.countAll<number>().as("count"),
              eb.fn.max("created_at").as("latest"),
            ])
            .where("project_id", "=", params.projectId)
            // Non-Expo builds carry no runtime version and have no OTA runtime row.
            .where("runtime_version", "is not", null)
            .groupBy("runtime_version")
            .execute(),
          db
            .selectFrom("updates")
            .select((eb) => [
              "runtime_version",
              eb.fn.countAll<number>().as("count"),
              eb.fn.max("created_at").as("latest"),
            ])
            .where(
              "branch_id",
              "in",
              db.selectFrom("branches").select("id").where("project_id", "=", params.projectId),
            )
            .groupBy("runtime_version")
            .execute(),
        ]),
      );

      const fromBuilds = buildRows.reduce<ReadonlyMap<string, RuntimeBucket>>(
        (map, row) =>
          row.runtime_version === null
            ? map
            : new Map(map).set(row.runtime_version, {
                buildsCount: row.count,
                updatesCount: 0,
                latestActivity: row.latest,
              }),
        new Map<string, RuntimeBucket>(),
      );
      const buckets = updateRows.reduce<ReadonlyMap<string, RuntimeBucket>>((map, row) => {
        const existing = map.get(row.runtime_version);
        return new Map(map).set(row.runtime_version, {
          buildsCount: existing?.buildsCount ?? 0,
          updatesCount: row.count,
          latestActivity: existing ? newerOf(existing.latestActivity, row.latest) : row.latest,
        });
      }, fromBuilds);

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
