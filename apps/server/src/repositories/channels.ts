import { toOptional } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";
import { chunk } from "es-toolkit";
import { sql } from "kysely";

import type {
  Expression,
  ExpressionBuilder,
  Kysely,
  Selectable,
  SelectQueryBuilder,
  SqlBool,
} from "kysely";

import { D1_IN_PARAM_CHUNK, d1Batch, kyselyDb } from "../cloudflare/db";
import { extractNewBranchId, extractReachableBranchIds } from "../domain/branch-mapping";
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
    /** Restrict to channels whose linked (default) branch is this branch. */
    readonly branchId?: string | undefined;
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

// List filter: project scope plus an optional linked-branch match and an
// optional case-insensitive LIKE substring match on the channel name (channels
// have no FTS table — LIKE is the only search path). Shared by the count and
// page queries so `total` respects every filter.
const channelFilter =
  (params: {
    readonly projectId: string;
    readonly query?: string | undefined;
    readonly branchId?: string | undefined;
  }) =>
  (eb: ExpressionBuilder<DB, "channels">): Expression<SqlBool> =>
    eb.and([
      eb("project_id", "=", params.projectId),
      ...(params.branchId ? [eb("branch_id", "=", params.branchId)] : []),
      ...(params.query
        ? [eb(eb.fn<string>("lower", ["name"]), "like", `%${params.query.toLowerCase()}%`)]
        : []),
    ]);

// Read rows carry the linked branch's name via a correlated subselect so API
// consumers never need a separate branches fetch to label channels. NULL only
// if the branch row vanished mid-read (FK normally guarantees presence).
const withBranchName = <Output>(qb: SelectQueryBuilder<DB, "channels", Output>) =>
  qb
    .select(CHANNEL_COLUMNS)
    .select((eb) =>
      eb
        .selectFrom("branches")
        .whereRef("branches.id", "=", "channels.branch_id")
        .select("branches.name")
        .as("branch_name"),
    );

const toChannel = (row: Selectable<Channels> & { readonly branch_name: string | null }) =>
  ({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    branchId: row.branch_id,
    branchName: toOptional(row.branch_name),
    branchMappingJson: row.branch_mapping_json,
    cacheVersion: row.cache_version,
    isPaused: row.is_paused === 1,
    isBuiltin: row.is_builtin === 1,
    createdAt: row.created_at,
  }) satisfies ChannelModel;

/**
 * Resolve the rollout-target branch name for channels with an active branch
 * mapping. Active rollouts are rare, so this usually short-circuits without a
 * query; otherwise one chunked IN lookup covers the whole page.
 */
const withRolloutTargetNames = (
  db: Kysely<DB>,
  channels: readonly ChannelModel[],
): Effect.Effect<readonly ChannelModel[]> =>
  Effect.gen(function* () {
    const targetByChannel = new Map(
      channels.flatMap((channel) => {
        if (channel.branchMappingJson === null) {
          return [];
        }
        const targetId = extractNewBranchId(channel.branchMappingJson);
        return targetId === null ? [] : [[channel.id, targetId] as const];
      }),
    );
    if (targetByChannel.size === 0) {
      return channels;
    }

    const uniqueTargetIds = [...new Set(targetByChannel.values())];
    const rowGroups = yield* Effect.forEach(chunk(uniqueTargetIds, D1_IN_PARAM_CHUNK), (ids) =>
      Effect.promise(async () =>
        db.selectFrom("branches").select(["id", "name"]).where("id", "in", ids).execute(),
      ),
    );
    const nameById = new Map(rowGroups.flat().map((row) => [row.id, row.name]));

    return channels.map((channel) => {
      const targetId = targetByChannel.get(channel.id);
      const name = targetId === undefined ? undefined : nameById.get(targetId);
      return name === undefined ? channel : { ...channel, rolloutTargetBranchName: name };
    });
  });

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

      const where = channelFilter(params);

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
        withBranchName(db.selectFrom("channels"))
          .where(where)
          .orderBy(primaryOrder, direction)
          .orderBy("id", direction)
          .limit(params.limit)
          .offset(params.offset)
          .execute(),
      );

      const items = yield* withRolloutTargetNames(db, rows.map(toChannel));
      return { items, total };
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const row = yield* Effect.promise(async () =>
        withBranchName(db.selectFrom("channels")).where("id", "=", params.id).executeTakeFirst(),
      );

      if (row === undefined) {
        return yield* new NotFound({ message: "Channel not found" });
      }

      const [channel] = yield* withRolloutTargetNames(db, [toChannel(row)]);
      return channel ?? toChannel(row);
    }),

  findByProjectAndName: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const row = yield* Effect.promise(async () =>
        withBranchName(db.selectFrom("channels"))
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
        withBranchName(db.selectFrom("channels"))
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
