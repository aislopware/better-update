import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { Conflict, NotFound } from "../errors";
import { CHANNEL_BRANCH_REFERENCE_PREDICATE } from "./channel-cache-version";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { BranchModel } from "../models";

// -- Port ------------------------------------------------------------------

export interface BranchRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly projectId: string;
    readonly name: string;
    readonly createdAt: string;
  }) => Effect.Effect<void, Conflict>;

  readonly findByProject: (params: {
    readonly projectId: string;
    readonly limit: number;
    readonly offset: number;
  }) => Effect.Effect<{ readonly items: readonly BranchModel[]; readonly total: number }>;

  readonly findById: (params: { readonly id: string }) => Effect.Effect<BranchModel, NotFound>;

  readonly findByProjectAndName: (params: {
    readonly projectId: string;
    readonly name: string;
  }) => Effect.Effect<BranchModel, NotFound>;

  readonly updateName: (params: {
    readonly id: string;
    readonly name: string;
  }) => Effect.Effect<void, Conflict>;

  readonly delete: (params: {
    readonly id: string;
  }) => Effect.Effect<{ readonly patchR2Keys: readonly string[] }, NotFound | Conflict>;
}

export class BranchRepo extends Context.Tag("api/BranchRepo")<BranchRepo, BranchRepository>() {}

// -- D1 Adapter ------------------------------------------------------------

interface BranchRow {
  id: string;
  project_id: string;
  name: string;
  created_at: string;
}

const toBranch = (row: BranchRow) =>
  ({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    createdAt: row.created_at,
  }) satisfies BranchModel;

export const BranchRepoLive = Layer.succeed(BranchRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      yield* d1RunWithUniqueCheck(
        async () =>
          env.DB.prepare(
            `INSERT INTO "branches" ("id", "project_id", "name", "created_at") VALUES (?, ?, ?, ?)`,
          )
            .bind(params.id, params.projectId, params.name, params.createdAt)
            .run(),
        `A branch named "${params.name}" already exists in this project`,
      );
    }),

  findByProject: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const countResult = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT COUNT(*) as count FROM "branches" WHERE "project_id" = ?`)
          .bind(params.projectId)
          .first<{ count: number }>(),
      );

      const total = countResult?.count ?? 0;

      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "id", "project_id", "name", "created_at" FROM "branches" WHERE "project_id" = ? ORDER BY "created_at" DESC LIMIT ? OFFSET ?`,
        )
          .bind(params.projectId, params.limit, params.offset)
          .all<BranchRow>(),
      );

      return { items: rows.results.map(toBranch), total };
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "id", "project_id", "name", "created_at" FROM "branches" WHERE "id" = ?`,
        )
          .bind(params.id)
          .first<BranchRow>(),
      );

      if (row === null) {
        return yield* Effect.fail(new NotFound({ message: "Branch not found" }));
      }

      return toBranch(row);
    }),

  findByProjectAndName: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "id", "project_id", "name", "created_at" FROM "branches" WHERE "project_id" = ? AND "name" = ?`,
        )
          .bind(params.projectId, params.name)
          .first<BranchRow>(),
      );

      if (row === null) {
        return yield* Effect.fail(new NotFound({ message: "Branch not found" }));
      }

      return toBranch(row);
    }),

  updateName: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      yield* d1RunWithUniqueCheck(
        async () =>
          env.DB.prepare(`UPDATE "branches" SET "name" = ? WHERE "id" = ?`)
            .bind(params.name, params.id)
            .run(),
        `A branch named "${params.name}" already exists in this project`,
      );
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      // Conflict guard: cannot delete branch while channels reference it
      // (either as current branch_id OR as a rollout target in branch_mapping_json)
      const channelCount = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT COUNT(*) as count FROM "channels" WHERE ${CHANNEL_BRANCH_REFERENCE_PREDICATE}`,
        )
          .bind(params.id, params.id)
          .first<{ count: number }>(),
      );

      if ((channelCount?.count ?? 0) > 0) {
        return yield* Effect.fail(
          new Conflict({ message: "Cannot delete branch while channels are linked to it" }),
        );
      }

      const branchAssets = `SELECT ua."asset_hash" FROM "update_assets" ua JOIN "updates" u ON ua."update_id" = u."id" WHERE u."branch_id" = ?`;
      const otherBranchAssets = `SELECT ua2."asset_hash" FROM "update_assets" ua2 JOIN "updates" u2 ON ua2."update_id" = u2."id" WHERE u2."branch_id" != ?`;

      // Collect patch R2 keys before cascade — only patches not referenced by other branches
      const patchRows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT p."r2_key" FROM "patches" p WHERE (p."old_asset_hash" IN (${branchAssets}) AND p."old_asset_hash" NOT IN (${otherBranchAssets})) OR (p."new_asset_hash" IN (${branchAssets}) AND p."new_asset_hash" NOT IN (${otherBranchAssets}))`,
        )
          .bind(params.id, params.id, params.id, params.id)
          .all<{ r2_key: string }>(),
      );

      // Cascade delete in FK dependency order
      yield* Effect.promise(async () =>
        env.DB.batch([
          env.DB.prepare(
            `DELETE FROM "patches" WHERE (("old_asset_hash" IN (${branchAssets}) AND "old_asset_hash" NOT IN (${otherBranchAssets})) OR ("new_asset_hash" IN (${branchAssets}) AND "new_asset_hash" NOT IN (${otherBranchAssets})))`,
          ).bind(params.id, params.id, params.id, params.id),
          env.DB.prepare(
            `DELETE FROM "update_assets" WHERE "update_id" IN (SELECT "id" FROM "updates" WHERE "branch_id" = ?)`,
          ).bind(params.id),
          env.DB.prepare(`DELETE FROM "updates" WHERE "branch_id" = ?`).bind(params.id),
          env.DB.prepare(`DELETE FROM "branches" WHERE "id" = ?`).bind(params.id),
        ]),
      );

      return { patchR2Keys: patchRows.results.map((row) => row.r2_key) };
    }),
});
