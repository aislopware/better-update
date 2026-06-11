import { Context, Effect, Layer } from "effect";
import { sql } from "kysely";

import type { Kysely } from "kysely";

import { d1Batch, kyselyDb } from "../cloudflare/db";
import { Conflict, NotFound } from "../errors";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { DB } from "../db/schema";
import type { BranchModel } from "../models";

// -- Port ------------------------------------------------------------------

export type BranchSortKey = "name" | "createdAt" | "updateCount";

export type BranchSortOrder = "asc" | "desc";

export interface BranchRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly projectId: string;
    readonly name: string;
    readonly isBuiltin: boolean;
    readonly createdAt: string;
  }) => Effect.Effect<void, Conflict>;

  readonly findByProject: (params: {
    readonly projectId: string;
    readonly query?: string | undefined;
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

/**
 * Base branch projection: the stored columns plus a correlated `update_count`
 * subquery (number of updates on the branch). Shared by every read so the
 * `toBranch` mapper always sees an identical row shape.
 */
const selectBranches = (db: Kysely<DB>) =>
  db.selectFrom("branches as b").select((eb) => [
    "b.id",
    "b.project_id",
    "b.name",
    "b.is_builtin",
    "b.created_at",
    eb
      .selectFrom("updates")
      .whereRef("updates.branch_id", "=", "b.id")
      .select((count) => count.fn.countAll<number>().as("count"))
      .$asScalar()
      .as("update_count"),
  ]);

type BranchListQuery = ReturnType<typeof selectBranches>;

type BranchRow = Awaited<ReturnType<BranchListQuery["execute"]>>[number];

const toBranch = (row: BranchRow) =>
  ({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    isBuiltin: row.is_builtin === 1,
    createdAt: row.created_at,
    updateCount: row.update_count,
  }) satisfies BranchModel;

/**
 * Apply the primary sort. `name` collates case-insensitively; `updateCount`
 * sorts on the computed alias. The caller adds the `b.id` tie-break.
 */
const orderByPrimary = (
  query: BranchListQuery,
  sort: BranchSortKey,
  order: BranchSortOrder,
): BranchListQuery => {
  if (sort === "name") {
    return query.orderBy(sql`"b"."name" COLLATE NOCASE`, order);
  }
  if (sort === "updateCount") {
    return query.orderBy("update_count", order);
  }
  return query.orderBy("b.created_at", order);
};

export const BranchRepoLive = Layer.succeed(BranchRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      yield* d1RunWithUniqueCheck(
        async () =>
          db
            .insertInto("branches")
            .values({
              id: params.id,
              project_id: params.projectId,
              name: params.name,
              is_builtin: params.isBuiltin ? 1 : 0,
              created_at: params.createdAt,
            })
            .execute(),
        `A branch named "${params.name}" already exists in this project`,
      );
    }),

  findByProject: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      // Optional case-insensitive LIKE substring match on the branch name
      // (branches have no FTS table — LIKE is the only search path). Applied to
      // BOTH the count and page queries so `total` respects the search.
      const pattern = params.query ? `%${params.query.toLowerCase()}%` : undefined;

      const countQuery = db.selectFrom("branches").where("project_id", "=", params.projectId);
      const totalRow = yield* Effect.promise(async () =>
        (pattern === undefined
          ? countQuery
          : countQuery.where((eb) => eb(eb.fn<string>("lower", ["name"]), "like", pattern))
        )
          .select((eb) => eb.fn.countAll<number>().as("count"))
          .executeTakeFirstOrThrow(),
      );

      const pageQuery = selectBranches(db).where("b.project_id", "=", params.projectId);
      const rows = yield* Effect.promise(async () =>
        orderByPrimary(
          pattern === undefined
            ? pageQuery
            : pageQuery.where((eb) => eb(eb.fn<string>("lower", ["b.name"]), "like", pattern)),
          params.sort,
          params.order,
        )
          .orderBy("b.id", params.order)
          .limit(params.limit)
          .offset(params.offset)
          .execute(),
      );

      return { items: rows.map(toBranch), total: totalRow.count };
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const row = yield* Effect.promise(async () =>
        selectBranches(db).where("b.id", "=", params.id).executeTakeFirst(),
      );

      if (!row) {
        return yield* new NotFound({ message: "Branch not found" });
      }

      return toBranch(row);
    }),

  findByProjectAndName: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const row = yield* Effect.promise(async () =>
        selectBranches(db)
          .where("b.project_id", "=", params.projectId)
          .where("b.name", "=", params.name)
          .executeTakeFirst(),
      );

      if (!row) {
        return yield* new NotFound({ message: "Branch not found" });
      }

      return toBranch(row);
    }),

  updateName: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      yield* d1RunWithUniqueCheck(
        async () =>
          db
            .updateTable("branches")
            .set({ name: params.name })
            .where("id", "=", params.id)
            .execute(),
        `A branch named "${params.name}" already exists in this project`,
      );
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      // Conflict guard: cannot delete a branch while channels reference it,
      // either as the current branch_id OR as a rollout target inside
      // branch_mapping_json. Mirrors CHANNEL_BRANCH_REFERENCE_PREDICATE in
      // channel-cache-version.ts (kept in sync); the json_each/json_extract
      // predicate has no query-builder form, so it uses the `sql` escape hatch.
      const channelCount = yield* Effect.promise(async () =>
        db
          .selectFrom("channels")
          .where(
            sql<boolean>`"branch_id" = ${params.id} OR ("branch_mapping_json" IS NOT NULL AND EXISTS (SELECT 1 FROM json_each("branch_mapping_json", '$.data') AS "branch_mapping_entry" WHERE json_extract("branch_mapping_entry"."value", '$.branchId') = ${params.id}))`,
          )
          .select((eb) => eb.fn.countAll<number>().as("count"))
          .executeTakeFirstOrThrow(),
      );

      if (channelCount.count > 0) {
        return yield* new Conflict({
          message: "Cannot delete branch while channels are linked to it",
        });
      }

      // Cascade delete in FK dependency order, atomically (D1 has no
      // interactive transactions — a batch is the only multi-statement atom).
      yield* d1Batch([
        db
          .deleteFrom("update_assets")
          .where(
            "update_id",
            "in",
            db.selectFrom("updates").select("updates.id").where("branch_id", "=", params.id),
          ),
        db.deleteFrom("updates").where("branch_id", "=", params.id),
        db.deleteFrom("branches").where("id", "=", params.id),
      ]);
    }),
});
