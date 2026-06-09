import { compact } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import { d1Batch, kyselyDb } from "../cloudflare/db";
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

const COLUMNS = [
  "id",
  "organization_id",
  "name",
  "description",
  "created_at",
  "updated_at",
] as const;

export const GroupRepoLive = Layer.succeed(GroupRepo, {
  list: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("iam_group")
          .select(COLUMNS)
          .where("organization_id", "=", params.organizationId)
          .orderBy("name", "asc")
          .execute(),
      );
      return rows.map(toModel);
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("iam_group")
          .select(COLUMNS)
          .where("id", "=", params.id)
          .where("organization_id", "=", params.organizationId)
          .executeTakeFirst(),
      );
      return row ? toModel(row) : null;
    }),

  create: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const row = yield* d1WithUniqueCheck(
        async () =>
          db
            .insertInto("iam_group")
            .values({
              id,
              organization_id: params.organizationId,
              name: params.name,
              description: params.description,
              created_at: now,
              updated_at: null,
            })
            .returning(COLUMNS)
            .executeTakeFirst(),
        "A group with this name already exists",
      );
      return row
        ? toModel(row)
        : {
            id,
            organizationId: params.organizationId,
            name: params.name,
            description: params.description,
            createdAt: now,
            updatedAt: null,
          };
    }),

  update: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const now = new Date().toISOString();
      // `compact` drops only `undefined` keys (a provided `null` description is
      // kept), mirroring the old COALESCE(name)/CASE(description) no-op skips.
      // `updated_at` is always set, so the SET is never empty.
      const patch = compact({ name: params.name, description: params.description });
      const row = yield* Effect.promise(async () =>
        db
          .updateTable("iam_group")
          .set({ ...patch, updated_at: now })
          .where("id", "=", params.id)
          .where("organization_id", "=", params.organizationId)
          .returning(COLUMNS)
          .executeTakeFirst(),
      );
      return row ? toModel(row) : null;
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      // Cascade in one atomic batch (D1 has no interactive transactions): sweep
      // policy attachments first, then the group itself (memberships cascade via
      // FK). The group delete returns its id so we can report whether a row went.
      const [, deleted] = yield* d1Batch([
        db
          .deleteFrom("policy_attachment")
          .where("principal_type", "=", "group")
          .where("principal_id", "=", params.id),
        db
          .deleteFrom("iam_group")
          .where("id", "=", params.id)
          .where("organization_id", "=", params.organizationId)
          .returning(["id"]),
      ]);
      return deleted.length > 0;
    }),

  findGroupIdsForMember: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("iam_group_membership")
          .select("group_id")
          .where("member_id", "=", params.memberId)
          .execute(),
      );
      return rows.map((row) => row.group_id);
    }),

  listMembers: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("iam_group_membership")
          .select(["member_id", "created_at"])
          .where("group_id", "=", params.groupId)
          .orderBy("created_at", "asc")
          .execute(),
      );
      return rows.map((row) => ({ memberId: row.member_id, createdAt: row.created_at }));
    }),

  addMember: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const now = new Date().toISOString();
      yield* Effect.promise(async () =>
        db
          .insertInto("iam_group_membership")
          .values({ group_id: params.groupId, member_id: params.memberId, created_at: now })
          .onConflict((oc) => oc.columns(["group_id", "member_id"]).doNothing())
          .execute(),
      );
    }),

  removeMember: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .deleteFrom("iam_group_membership")
          .where("group_id", "=", params.groupId)
          .where("member_id", "=", params.memberId)
          .execute(),
      );
    }),
});
