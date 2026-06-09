import { Context, Effect, Layer } from "effect";

import type { AdminUserStatus } from "@better-update/api";
import type { Expression, ExpressionBuilder, SqlBool } from "kysely";

import { kyselyDb } from "../cloudflare/db";

import type { DB } from "../db/schema";

// ── Port ──────────────────────────────────────────────────────────

export interface AdminUserRecord {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: string | null;
  readonly approved: boolean;
  readonly banned: boolean;
  readonly createdAt: string;
}

export interface AdminUsersRepository {
  readonly list: (params: {
    readonly search?: string | undefined;
    readonly status?: AdminUserStatus | undefined;
    readonly limit: number;
    readonly offset: number;
  }) => Effect.Effect<{ readonly items: readonly AdminUserRecord[]; readonly total: number }>;

  readonly setApproved: (params: {
    readonly userId: string;
    readonly approved: boolean;
  }) => Effect.Effect<AdminUserRecord | null>;
}

export class AdminUsersRepo extends Context.Tag("server/AdminUsersRepo")<
  AdminUsersRepo,
  AdminUsersRepository
>() {}

// ── D1 Adapter ────────────────────────────────────────────────────

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string | null;
  approved: number | null;
  banned: number | null;
  created_at: string;
}

const COLUMNS = ["id", "name", "email", "role", "approved", "banned", "created_at"] as const;

const toRecord = (row: UserRow): AdminUserRecord => ({
  id: row.id,
  name: row.name,
  email: row.email,
  role: row.role,
  approved: row.approved === 1,
  banned: row.banned === 1,
  createdAt: row.created_at,
});

// Optional status / search predicates combined into one WHERE, reused by both
// the count and the page query. SECURITY: only the search *value* is
// user-controlled and it is parameterized by the query builder, never
// concatenated.
const userFilter =
  (params: { readonly status: AdminUserStatus | undefined; readonly search: string | undefined }) =>
  (eb: ExpressionBuilder<DB, "user">): Expression<SqlBool> => {
    const search = params.search?.trim();
    const pattern = search !== undefined && search.length > 0 ? `%${search.toLowerCase()}%` : null;
    const conditions: (Expression<SqlBool> | null)[] = [
      params.status === "pending" ? eb("approved", "=", 0) : null,
      params.status === "approved" ? eb("approved", "=", 1) : null,
      pattern === null
        ? null
        : eb.or([
            eb(eb.fn<string>("lower", ["name"]), "like", pattern),
            eb(eb.fn<string>("lower", ["email"]), "like", pattern),
          ]),
    ];
    return eb.and(
      conditions.filter((condition): condition is Expression<SqlBool> => condition !== null),
    );
  };

export const AdminUsersRepoLive = Layer.succeed(AdminUsersRepo, {
  list: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const where = userFilter({ status: params.status, search: params.search });

      const countRow = yield* Effect.promise(async () =>
        db
          .selectFrom("user")
          .where(where)
          .select((eb) => eb.fn.countAll<number>().as("count"))
          .executeTakeFirstOrThrow(),
      );
      const total = countRow.count;

      // Pending (approved = 0) first, then newest, so users awaiting approval
      // surface at the top of the "all" view.
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("user")
          .where(where)
          .select(COLUMNS)
          .orderBy("approved", "asc")
          .orderBy("created_at", "desc")
          .limit(params.limit)
          .offset(params.offset)
          .execute(),
      );

      return { items: rows.map(toRecord), total };
    }),

  setApproved: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const row = yield* Effect.promise(async () =>
        db
          .updateTable("user")
          .set({ approved: params.approved ? 1 : 0 })
          .where("id", "=", params.userId)
          .returning(COLUMNS)
          .executeTakeFirst(),
      );

      return row ? toRecord(row) : null;
    }),
});
