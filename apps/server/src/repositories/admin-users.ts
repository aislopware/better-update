import { Context, Effect, Layer } from "effect";

import type { AdminUserStatus } from "@better-update/api";

import { cloudflareEnv } from "../cloudflare/context";

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

const USER_COLUMNS = `"id", "name", "email", "role", "approved", "banned", "created_at"`;

const toRecord = (row: UserRow): AdminUserRecord => ({
  id: row.id,
  name: row.name,
  email: row.email,
  role: row.role,
  approved: row.approved === 1,
  banned: row.banned === 1,
  createdAt: row.created_at,
});

// status → SQL predicate on the `approved` column (0/1).
const statusWhere = (status: AdminUserStatus | undefined): string | null => {
  if (status === "pending") {
    return `"approved" = 0`;
  }
  if (status === "approved") {
    return `"approved" = 1`;
  }
  return null;
};

export const AdminUsersRepoLive = Layer.succeed(AdminUsersRepo, {
  list: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const clauses: string[] = [];
      const binds: (string | number)[] = [];

      const statusClause = statusWhere(params.status);
      if (statusClause !== null) {
        clauses.push(statusClause);
      }

      const search = params.search?.trim();
      if (search !== undefined && search.length > 0) {
        const pattern = `%${search.toLowerCase()}%`;
        clauses.push(`(LOWER("name") LIKE ? OR LOWER("email") LIKE ?)`);
        binds.push(pattern, pattern);
      }

      const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

      const countResult = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT COUNT(*) as count FROM "user" ${whereClause}`)
          .bind(...binds)
          .first<{ count: number }>(),
      );
      const total = countResult?.count ?? 0;

      // Pending (approved = 0) first, then newest, so users awaiting approval
      // surface at the top of the "all" view.
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${USER_COLUMNS} FROM "user" ${whereClause} ORDER BY "approved" ASC, "created_at" DESC LIMIT ? OFFSET ?`,
        )
          .bind(...binds, params.limit, params.offset)
          .all<UserRow>(),
      );

      return { items: rows.results.map(toRecord), total };
    }),

  setApproved: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      yield* Effect.promise(async () =>
        env.DB.prepare(`UPDATE "user" SET "approved" = ? WHERE "id" = ?`)
          .bind(params.approved ? 1 : 0, params.userId)
          .run(),
      );

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${USER_COLUMNS} FROM "user" WHERE "id" = ?`)
          .bind(params.userId)
          .first<UserRow>(),
      );

      return row === null ? null : toRecord(row);
    }),
});
