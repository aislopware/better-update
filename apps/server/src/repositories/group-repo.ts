import { toDbNull } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { d1WithUniqueCheck } from "./d1-helpers";

import type { Conflict } from "../errors";
import type { GroupModel } from "../models";

// -- Port -------------------------------------------------------------------

export interface GroupMemberRow {
  readonly memberId: string;
  readonly createdAt: string;
}

export interface GroupRepository {
  readonly list: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly GroupModel[]>;

  readonly findById: (params: {
    readonly id: string;
    readonly organizationId: string;
  }) => Effect.Effect<GroupModel | null>;

  /** Create a group. Fails {@link Conflict} when the org already has this name. */
  readonly create: (params: {
    readonly organizationId: string;
    readonly name: string;
    readonly description: string | null;
  }) => Effect.Effect<GroupModel, Conflict>;

  readonly update: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly name?: string;
    readonly description?: string | null;
  }) => Effect.Effect<GroupModel | null>;

  /** Delete a group + sweep its attachments (memberships cascade via FK). */
  readonly delete: (params: {
    readonly id: string;
    readonly organizationId: string;
  }) => Effect.Effect<boolean>;

  /** Group ids a member belongs to (one indexed read). */
  readonly findGroupIdsForMember: (params: {
    readonly memberId: string;
  }) => Effect.Effect<readonly string[]>;

  readonly listMembers: (params: {
    readonly groupId: string;
  }) => Effect.Effect<readonly GroupMemberRow[]>;

  readonly addMember: (params: {
    readonly groupId: string;
    readonly memberId: string;
  }) => Effect.Effect<void>;

  readonly removeMember: (params: {
    readonly groupId: string;
    readonly memberId: string;
  }) => Effect.Effect<void>;
}

export class GroupRepo extends Context.Tag("api/GroupRepo")<GroupRepo, GroupRepository>() {}

// -- D1 Adapter -------------------------------------------------------------

interface GroupRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string | null;
}

const toModel = (row: GroupRow): GroupModel => ({
  id: row.id,
  organizationId: row.organization_id,
  name: row.name,
  description: row.description,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const COLUMNS = `"id", "organization_id", "name", "description", "created_at", "updated_at"`;

export const GroupRepoLive = Layer.succeed(GroupRepo, {
  list: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "iam_group" WHERE "organization_id" = ? ORDER BY "name" ASC`,
        )
          .bind(params.organizationId)
          .all<GroupRow>(),
      );
      return rows.results.map(toModel);
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "iam_group" WHERE "id" = ? AND "organization_id" = ?`,
        )
          .bind(params.id, params.organizationId)
          .first<GroupRow>(),
      );
      return row === null ? null : toModel(row);
    }),

  create: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const row = yield* d1WithUniqueCheck(
        async () =>
          env.DB.prepare(
            `INSERT INTO "iam_group" (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?) RETURNING ${COLUMNS}`,
          )
            .bind(id, params.organizationId, params.name, params.description, now, null)
            .first<GroupRow>(),
        "A group with this name already exists",
      );
      return row === null
        ? {
            id,
            organizationId: params.organizationId,
            name: params.name,
            description: params.description,
            createdAt: now,
            updatedAt: null,
          }
        : toModel(row);
    }),

  update: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const now = new Date().toISOString();
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `UPDATE "iam_group" SET
             "name" = COALESCE(?, "name"),
             "description" = CASE WHEN ? = 1 THEN ? ELSE "description" END,
             "updated_at" = ?
           WHERE "id" = ? AND "organization_id" = ?
           RETURNING ${COLUMNS}`,
        )
          .bind(
            toDbNull(params.name),
            params.description === undefined ? 0 : 1,
            toDbNull(params.description),
            now,
            params.id,
            params.organizationId,
          )
          .first<GroupRow>(),
      );
      return row === null ? null : toModel(row);
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const result = yield* Effect.promise(async () =>
        env.DB.batch([
          env.DB.prepare(
            `DELETE FROM "policy_attachment" WHERE "principal_type" = 'group' AND "principal_id" = ?`,
          ).bind(params.id),
          env.DB.prepare(`DELETE FROM "iam_group" WHERE "id" = ? AND "organization_id" = ?`).bind(
            params.id,
            params.organizationId,
          ),
        ]),
      );
      return (result[1]?.meta.changes ?? 0) > 0;
    }),

  findGroupIdsForMember: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT "group_id" FROM "iam_group_membership" WHERE "member_id" = ?`)
          .bind(params.memberId)
          .all<{ group_id: string }>(),
      );
      return rows.results.map((row) => row.group_id);
    }),

  listMembers: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "member_id", "created_at" FROM "iam_group_membership" WHERE "group_id" = ? ORDER BY "created_at" ASC`,
        )
          .bind(params.groupId)
          .all<{ member_id: string; created_at: string }>(),
      );
      return rows.results.map((row) => ({ memberId: row.member_id, createdAt: row.created_at }));
    }),

  addMember: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const now = new Date().toISOString();
      yield* Effect.promise(async () =>
        env.DB.prepare(
          `INSERT INTO "iam_group_membership" ("group_id", "member_id", "created_at") VALUES (?, ?, ?) ON CONFLICT ("group_id", "member_id") DO NOTHING`,
        )
          .bind(params.groupId, params.memberId, now)
          .run(),
      );
    }),

  removeMember: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.prepare(
          `DELETE FROM "iam_group_membership" WHERE "group_id" = ? AND "member_id" = ?`,
        )
          .bind(params.groupId, params.memberId)
          .run(),
      );
    }),
});
