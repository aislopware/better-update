import { Context, Effect, Layer } from "effect";
import { sql } from "kysely";

import type { Expression, ExpressionBuilder, Selectable, SqlBool } from "kysely";

import { d1Batch, kyselyDb } from "../cloudflare/db";
import { extractReachableBranchIds } from "../domain/branch-mapping";
import { NotFound } from "../errors";
import { bumpChannelCacheVersionByBranchReference } from "./channel-cache-version";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { Channels, DB } from "../db/schema";
import type { Conflict } from "../errors";
import type { ChannelModel } from "../models";

// -- Port ------------------------------------------------------------------

export type ChannelSortKey = "name" | "createdAt";

export type ChannelSortOrder = "asc" | "desc";

export interface ChannelRepository {
  readonly insert: (params: {
    readonly projectId: string;
    readonly name: string;
    readonly branchId: string;
    readonly isBuiltin?: boolean;
  }) => Effect.Effect<ChannelModel, Conflict>;

  readonly findByProject: (params: {
    readonly projectId: string;
    readonly query?: string | undefined;
    readonly sort: ChannelSortKey;
    readonly order: ChannelSortOrder;
    readonly limit: number;
    readonly offset: number;
  }) => Effect.Effect<{ readonly items: readonly ChannelModel[]; readonly total: number }>;

  readonly findById: (params: { readonly id: string }) => Effect.Effect<ChannelModel, NotFound>;

  readonly findByProjectAndName: (params: {
    readonly projectId: string;
    readonly name: string;
  }) => Effect.Effect<ChannelModel, NotFound>;

  /**
   * The owning channel for a branch (the channel whose `branch_id` is this
   * branch), oldest first if several map the same branch. `null` when none.
   * Consumed by the rollout-percentage gate to resolve the channel scope from an
   * update's branch.
   */
  readonly findByBranchId: (params: {
    readonly branchId: string;
  }) => Effect.Effect<ChannelModel | null>;

  readonly updateBranchId: (params: {
    readonly id: string;
    readonly branchId: string;
  }) => Effect.Effect<void>;

  readonly setPaused: (params: {
    readonly id: string;
    readonly isPaused: boolean;
  }) => Effect.Effect<void>;

  readonly setBranchMapping: (params: {
    readonly id: string;
    readonly branchMappingJson: string;
  }) => Effect.Effect<void>;

  readonly completeBranchRollout: (params: {
    readonly id: string;
    readonly branchId: string;
  }) => Effect.Effect<void>;

  readonly revertBranchRollout: (params: { readonly id: string }) => Effect.Effect<void>;

  readonly bumpCacheVersionByBranch: (params: { readonly branchId: string }) => Effect.Effect<void>;

  readonly delete: (params: { readonly id: string }) => Effect.Effect<void, NotFound>;

  /**
   * Union of every branch a project's channels can currently serve: each
   * channel's `branch_id` PLUS every reachable branch in its
   * `branch_mapping_json` (gradual rollout targets). The OTA reaper uses this to
   * protect channel-current / reachable-branch updates from reaping.
   */
  readonly listReachableBranchIdsByProject: (params: {
    readonly projectId: string;
  }) => Effect.Effect<readonly string[]>;
}

export class ChannelRepo extends Context.Tag("api/ChannelRepo")<ChannelRepo, ChannelRepository>() {}

// -- D1 Adapter ------------------------------------------------------------

const CHANNEL_COLUMNS = [
  "id",
  "project_id",
  "name",
  "branch_id",
  "branch_mapping_json",
  "cache_version",
  "is_paused",
  "is_builtin",
  "created_at",
] as const;

// List filter: project scope plus an optional case-insensitive LIKE substring
// match on the channel name (channels have no FTS table — LIKE is the only
// search path). Shared by the count and page queries so `total` respects the
// search.
const channelFilter =
  (projectId: string, query: string | undefined) =>
  (eb: ExpressionBuilder<DB, "channels">): Expression<SqlBool> => {
    const projectMatch = eb("project_id", "=", projectId);
    if (!query) {
      return projectMatch;
    }
    const pattern = `%${query.toLowerCase()}%`;
    return eb.and([eb(eb.fn<string>("lower", ["name"]), "like", pattern), projectMatch]);
  };

const toChannel = (row: Selectable<Channels>) =>
  ({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    branchId: row.branch_id,
    branchMappingJson: row.branch_mapping_json,
    cacheVersion: row.cache_version,
    isPaused: row.is_paused === 1,
    isBuiltin: row.is_builtin === 1,
    createdAt: row.created_at,
  }) satisfies ChannelModel;

export const ChannelRepoLive = Layer.succeed(ChannelRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      yield* d1RunWithUniqueCheck(
        async () =>
          db
            .insertInto("channels")
            .values({
              id,
              project_id: params.projectId,
              name: params.name,
              branch_id: params.branchId,
              branch_mapping_json: null,
              cache_version: 0,
              is_paused: 0,
              is_builtin: params.isBuiltin ? 1 : 0,
              created_at: now,
            })
            .execute(),
        `A channel named "${params.name}" already exists in this project`,
      );

      return {
        id,
        projectId: params.projectId,
        name: params.name,
        branchId: params.branchId,
        branchMappingJson: null,
        cacheVersion: 0,
        isPaused: false,
        isBuiltin: params.isBuiltin ?? false,
        createdAt: now,
      } satisfies ChannelModel;
    }),

  findByProject: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const where = channelFilter(params.projectId, params.query);

      const countRow = yield* Effect.promise(async () =>
        db
          .selectFrom("channels")
          .where(where)
          .select((eb) => eb.fn.countAll<number>().as("count"))
          .executeTakeFirstOrThrow(),
      );
      const total = countRow.count;

      const direction = params.order === "asc" ? "asc" : "desc";
      const primaryOrder =
        params.sort === "name" ? sql`"name" collate nocase` : sql.ref("created_at");

      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("channels")
          .select(CHANNEL_COLUMNS)
          .where(where)
          .orderBy(primaryOrder, direction)
          .orderBy("id", direction)
          .limit(params.limit)
          .offset(params.offset)
          .execute(),
      );

      return { items: rows.map(toChannel), total };
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("channels")
          .select(CHANNEL_COLUMNS)
          .where("id", "=", params.id)
          .executeTakeFirst(),
      );

      if (row === undefined) {
        return yield* new NotFound({ message: "Channel not found" });
      }

      return toChannel(row);
    }),

  findByProjectAndName: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("channels")
          .select(CHANNEL_COLUMNS)
          .where("project_id", "=", params.projectId)
          .where("name", "=", params.name)
          .executeTakeFirst(),
      );

      if (row === undefined) {
        return yield* new NotFound({ message: "Channel not found" });
      }

      return toChannel(row);
    }),

  findByBranchId: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("channels")
          .select(CHANNEL_COLUMNS)
          .where("branch_id", "=", params.branchId)
          .orderBy("created_at", "asc")
          .orderBy("id", "asc")
          .limit(1)
          .executeTakeFirst(),
      );

      return row === undefined ? null : toChannel(row);
    }),

  updateBranchId: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      yield* Effect.promise(async () =>
        db
          .updateTable("channels")
          .set((eb) => ({
            branch_id: params.branchId,
            cache_version: eb("cache_version", "+", 1),
          }))
          .where("id", "=", params.id)
          .execute(),
      );
    }),

  setPaused: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      yield* Effect.promise(async () =>
        db
          .updateTable("channels")
          .set((eb) => ({
            is_paused: params.isPaused ? 1 : 0,
            cache_version: eb("cache_version", "+", 1),
          }))
          .where("id", "=", params.id)
          .execute(),
      );
    }),

  setBranchMapping: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      yield* Effect.promise(async () =>
        db
          .updateTable("channels")
          .set((eb) => ({
            branch_mapping_json: params.branchMappingJson,
            cache_version: eb("cache_version", "+", 1),
          }))
          .where("id", "=", params.id)
          .execute(),
      );
    }),

  completeBranchRollout: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      yield* Effect.promise(async () =>
        db
          .updateTable("channels")
          .set((eb) => ({
            branch_id: params.branchId,
            branch_mapping_json: null,
            cache_version: eb("cache_version", "+", 1),
          }))
          .where("id", "=", params.id)
          .execute(),
      );
    }),

  revertBranchRollout: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      yield* Effect.promise(async () =>
        db
          .updateTable("channels")
          .set((eb) => ({
            branch_mapping_json: null,
            cache_version: eb("cache_version", "+", 1),
          }))
          .where("id", "=", params.id)
          .execute(),
      );
    }),

  bumpCacheVersionByBranch: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* bumpChannelCacheVersionByBranchReference(db, params.branchId);
    }),

  listReachableBranchIdsByProject: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("channels")
          .select(["branch_id", "branch_mapping_json"])
          .where("project_id", "=", params.projectId)
          .execute(),
      );

      const currentBranchIds = rows.map((row) => row.branch_id);
      const reachableBranchIds = rows.flatMap((row) =>
        row.branch_mapping_json === null ? [] : extractReachableBranchIds(row.branch_mapping_json),
      );
      return [...new Set([...currentBranchIds, ...reachableBranchIds])];
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      yield* d1Batch([
        db
          .updateTable("channels")
          .set((eb) => ({ cache_version: eb("cache_version", "+", 1) }))
          .where("id", "=", params.id),
        db.deleteFrom("channels").where("id", "=", params.id),
      ]);
    }),
});
