import { Branch, NotFound } from "@better-update/api";
import { Context, Effect, Layer } from "effect";

import type { Conflict } from "@better-update/api";

import { cloudflareEnv } from "../cloudflare/context";
import { d1RunWithUniqueCheck } from "./d1-helpers";

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
  }) => Effect.Effect<{ readonly items: readonly Branch[]; readonly total: number }>;

  readonly findById: (params: { readonly id: string }) => Effect.Effect<Branch, NotFound>;

  readonly updateName: (params: {
    readonly id: string;
    readonly name: string;
  }) => Effect.Effect<void, Conflict>;
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
  new Branch({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    createdAt: row.created_at,
  });

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
});
