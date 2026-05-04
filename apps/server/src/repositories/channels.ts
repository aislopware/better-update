import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";
import { encodeCursor } from "../lib/cursor";
import { bumpChannelCacheVersionByBranchReference } from "./channel-cache-version";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { Conflict } from "../errors";
import type { Cursor } from "../lib/cursor";
import type { ChannelModel } from "../models";

// -- Port ------------------------------------------------------------------

export interface ChannelRepository {
  readonly insert: (params: {
    readonly projectId: string;
    readonly name: string;
    readonly branchId: string;
  }) => Effect.Effect<ChannelModel, Conflict>;

  readonly findByProject: (params: {
    readonly projectId: string;
    readonly cursor: Cursor | null;
    readonly limit: number;
  }) => Effect.Effect<{
    readonly items: readonly ChannelModel[];
    readonly nextCursor: string | null;
  }>;

  readonly findById: (params: { readonly id: string }) => Effect.Effect<ChannelModel, NotFound>;

  readonly findByProjectAndName: (params: {
    readonly projectId: string;
    readonly name: string;
  }) => Effect.Effect<ChannelModel, NotFound>;

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

      const filters: string[] = [`"project_id" = ?`];
      const bindings: (string | number)[] = [params.projectId];
      if (params.cursor) {
        filters.push(`("created_at" < ? OR ("created_at" = ? AND "id" < ?))`);
        bindings.push(params.cursor.createdAt, params.cursor.createdAt, params.cursor.id);
      }

      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "id", "project_id", "name", "branch_id", "branch_mapping_json", "cache_version", "is_paused", "created_at" FROM "channels" WHERE ${filters.join(" AND ")} ORDER BY "created_at" DESC, "id" DESC LIMIT ?`,
        )
          .bind(...bindings, params.limit + 1)
          .all<ChannelRow>(),
      );

      const hasMore = rows.results.length > params.limit;
      const trimmed = hasMore ? rows.results.slice(0, params.limit) : rows.results;
      const last = trimmed.at(-1);
      const nextCursor =
        hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null;

      return { items: trimmed.map(toChannel), nextCursor };
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
