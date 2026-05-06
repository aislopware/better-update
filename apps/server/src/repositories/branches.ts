import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { Conflict, NotFound } from "../errors";
import { CHANNEL_BRANCH_REFERENCE_PREDICATE } from "./channel-cache-version";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { BranchModel } from "../models";

// -- Port ------------------------------------------------------------------

export type BranchSortKey = "name" | "createdAt" | "updateCount";

export type BranchSortOrder = "asc" | "desc";

export interface BranchRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly projectId: string;
    readonly name: string;
    readonly createdAt: string;
  }) => Effect.Effect<void, Conflict>;

  readonly findByProject: (params: {
    readonly projectId: string;
    readonly sort: BranchSortKey;
    readonly order: BranchSortOrder;
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

  readonly delete: (params: { readonly id: string }) => Effect.Effect<void, NotFound | Conflict>;
}

export class BranchRepo extends Context.Tag("api/BranchRepo")<BranchRepo, BranchRepository>() {}

// -- D1 Adapter ------------------------------------------------------------

interface BranchRow {
  id: string;
  project_id: string;
  name: string;
  created_at: string;
  update_count: number;
}

const BRANCH_COLUMNS = `b."id", b."project_id", b."name", b."created_at", (SELECT COUNT(*) FROM "updates" WHERE "updates"."branch_id" = b."id") AS "update_count"`;

const toBranch = (row: BranchRow) =>
  ({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    createdAt: row.created_at,
    updateCount: row.update_count,
  }) satisfies BranchModel;

const sortColumns: Record<BranchSortKey, string> = {
  name: 'b."name" COLLATE NOCASE',
  createdAt: 'b."created_at"',
  updateCount: '"update_count"',
};

const sortClause = (sort: BranchSortKey, order: BranchSortOrder): string => {
  const direction = order === "asc" ? "ASC" : "DESC";
  return `${sortColumns[sort]} ${direction}, b."id" ${direction}`;
};

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
        env.DB.prepare(`SELECT COUNT(*) as count FROM "branches" b WHERE b."project_id" = ?`)
          .bind(params.projectId)
          .first<{ count: number }>(),
      );

      const total = countResult?.count ?? 0;

      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${BRANCH_COLUMNS} FROM "branches" b WHERE b."project_id" = ? ORDER BY ${sortClause(params.sort, params.order)} LIMIT ? OFFSET ?`,
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
        env.DB.prepare(`SELECT ${BRANCH_COLUMNS} FROM "branches" b WHERE b."id" = ?`)
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
          `SELECT ${BRANCH_COLUMNS} FROM "branches" b WHERE b."project_id" = ? AND b."name" = ?`,
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
        yield* Effect.fail(
          new Conflict({ message: "Cannot delete branch while channels are linked to it" }),
        );
      }

      // Cascade delete in FK dependency order
      yield* Effect.promise(async () =>
        env.DB.batch([
          env.DB.prepare(
            `DELETE FROM "update_assets" WHERE "update_id" IN (SELECT "id" FROM "updates" WHERE "branch_id" = ?)`,
          ).bind(params.id),
          env.DB.prepare(`DELETE FROM "updates" WHERE "branch_id" = ?`).bind(params.id),
          env.DB.prepare(`DELETE FROM "branches" WHERE "id" = ?`).bind(params.id),
        ]),
      );
    }),
});
