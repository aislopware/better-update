import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { Conflict, NotFound } from "../errors";
import { encodeCursor } from "../lib/cursor";
import { CHANNEL_BRANCH_REFERENCE_PREDICATE } from "./channel-cache-version";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { Cursor } from "../lib/cursor";
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
    readonly cursor: Cursor | null;
    readonly limit: number;
  }) => Effect.Effect<{
    readonly items: readonly BranchModel[];
    readonly nextCursor: string | null;
  }>;

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

      const filters: string[] = [`"project_id" = ?`];
      const bindings: (string | number)[] = [params.projectId];
      if (params.cursor) {
        filters.push(`("created_at" < ? OR ("created_at" = ? AND "id" < ?))`);
        bindings.push(params.cursor.createdAt, params.cursor.createdAt, params.cursor.id);
      }

      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "id", "project_id", "name", "created_at" FROM "branches" WHERE ${filters.join(" AND ")} ORDER BY "created_at" DESC, "id" DESC LIMIT ?`,
        )
          .bind(...bindings, params.limit + 1)
          .all<BranchRow>(),
      );

      const hasMore = rows.results.length > params.limit;
      const trimmed = hasMore ? rows.results.slice(0, params.limit) : rows.results;
      const last = trimmed.at(-1);
      const nextCursor =
        hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null;

      return { items: trimmed.map(toBranch), nextCursor };
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
