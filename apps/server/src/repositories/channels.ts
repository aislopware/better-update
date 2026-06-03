import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { extractReachableBranchIds } from "../domain/branch-mapping";
import { NotFound } from "../errors";
import { bumpChannelCacheVersionByBranchReference } from "./channel-cache-version";
import { d1RunWithUniqueCheck } from "./d1-helpers";

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
  }) => Effect.Effect<ChannelModel, Conflict>;

  readonly findByProject: (params: {
    readonly projectId: string;
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

interface ChannelRow {
  id: string;
  project_id: string;
  name: string;
  branch_id: string;
  branch_mapping_json: string | null;
  cache_version: number;
  is_paused: number;
  created_at: string;
}

const toChannel = (row: ChannelRow) =>
  ({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    branchId: row.branch_id,
    branchMappingJson: row.branch_mapping_json,
    cacheVersion: row.cache_version,
    isPaused: row.is_paused === 1,
    createdAt: row.created_at,
  }) satisfies ChannelModel;

export const ChannelRepoLive = Layer.succeed(ChannelRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      yield* d1RunWithUniqueCheck(
        async () =>
          env.DB.prepare(
            `INSERT INTO "channels" ("id", "project_id", "name", "branch_id", "branch_mapping_json", "cache_version", "is_paused", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
            .bind(id, params.projectId, params.name, params.branchId, null, 0, 0, now)
            .run(),
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
        createdAt: now,
      } satisfies ChannelModel;
    }),

  findByProject: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const countResult = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT COUNT(*) as count FROM "channels" WHERE "project_id" = ?`)
          .bind(params.projectId)
          .first<{ count: number }>(),
      );

      const total = countResult?.count ?? 0;

      const sortColumns: Record<ChannelSortKey, string> = {
        name: '"name" COLLATE NOCASE',
        createdAt: '"created_at"',
      };
      const direction = params.order === "asc" ? "ASC" : "DESC";
      const orderBy = `${sortColumns[params.sort]} ${direction}, "id" ${direction}`;

      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "id", "project_id", "name", "branch_id", "branch_mapping_json", "cache_version", "is_paused", "created_at" FROM "channels" WHERE "project_id" = ? ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
        )
          .bind(params.projectId, params.limit, params.offset)
          .all<ChannelRow>(),
      );

      return { items: rows.results.map(toChannel), total };
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "id", "project_id", "name", "branch_id", "branch_mapping_json", "cache_version", "is_paused", "created_at" FROM "channels" WHERE "id" = ?`,
        )
          .bind(params.id)
          .first<ChannelRow>(),
      );

      if (row === null) {
        return yield* Effect.fail(new NotFound({ message: "Channel not found" }));
      }

      return toChannel(row);
    }),

  findByProjectAndName: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "id", "project_id", "name", "branch_id", "branch_mapping_json", "cache_version", "is_paused", "created_at" FROM "channels" WHERE "project_id" = ? AND "name" = ?`,
        )
          .bind(params.projectId, params.name)
          .first<ChannelRow>(),
      );

      if (row === null) {
        return yield* Effect.fail(new NotFound({ message: "Channel not found" }));
      }

      return toChannel(row);
    }),

  findByBranchId: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "id", "project_id", "name", "branch_id", "branch_mapping_json", "cache_version", "is_paused", "created_at" FROM "channels" WHERE "branch_id" = ? ORDER BY "created_at" ASC, "id" ASC LIMIT 1`,
        )
          .bind(params.branchId)
          .first<ChannelRow>(),
      );

      return row === null ? null : toChannel(row);
    }),

  updateBranchId: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      yield* Effect.promise(async () =>
        env.DB.prepare(
          `UPDATE "channels" SET "branch_id" = ?, "cache_version" = "cache_version" + 1 WHERE "id" = ?`,
        )
          .bind(params.branchId, params.id)
          .run(),
      );
    }),

  setPaused: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      yield* Effect.promise(async () =>
        env.DB.prepare(
          `UPDATE "channels" SET "is_paused" = ?, "cache_version" = "cache_version" + 1 WHERE "id" = ?`,
        )
          .bind(params.isPaused ? 1 : 0, params.id)
          .run(),
      );
    }),

  setBranchMapping: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      yield* Effect.promise(async () =>
        env.DB.prepare(
          `UPDATE "channels" SET "branch_mapping_json" = ?, "cache_version" = "cache_version" + 1 WHERE "id" = ?`,
        )
          .bind(params.branchMappingJson, params.id)
          .run(),
      );
    }),

  completeBranchRollout: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      yield* Effect.promise(async () =>
        env.DB.prepare(
          `UPDATE "channels" SET "branch_id" = ?, "branch_mapping_json" = NULL, "cache_version" = "cache_version" + 1 WHERE "id" = ?`,
        )
          .bind(params.branchId, params.id)
          .run(),
      );
    }),

  revertBranchRollout: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      yield* Effect.promise(async () =>
        env.DB.prepare(
          `UPDATE "channels" SET "branch_mapping_json" = NULL, "cache_version" = "cache_version" + 1 WHERE "id" = ?`,
        )
          .bind(params.id)
          .run(),
      );
    }),

  bumpCacheVersionByBranch: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* bumpChannelCacheVersionByBranchReference(env.DB, params.branchId);
    }),

  listReachableBranchIdsByProject: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "branch_id", "branch_mapping_json" FROM "channels" WHERE "project_id" = ?`,
        )
          .bind(params.projectId)
          .all<{ branch_id: string; branch_mapping_json: string | null }>(),
      );

      const currentBranchIds = rows.results.map((row) => row.branch_id);
      const reachableBranchIds = rows.results.flatMap((row) =>
        row.branch_mapping_json === null ? [] : extractReachableBranchIds(row.branch_mapping_json),
      );
      return [...new Set([...currentBranchIds, ...reachableBranchIds])];
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      yield* Effect.promise(async () =>
        env.DB.batch([
          env.DB.prepare(
            `UPDATE "channels" SET "cache_version" = "cache_version" + 1 WHERE "id" = ?`,
          ).bind(params.id),
          env.DB.prepare(`DELETE FROM "channels" WHERE "id" = ?`).bind(params.id),
        ]),
      );
    }),
});
