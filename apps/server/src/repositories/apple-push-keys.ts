import { toDbNull } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import type { Selectable } from "kysely";

import { kyselyDb } from "../cloudflare/db";
import { NotFound } from "../errors";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { ApplePushKeys } from "../db/schema";
import type { Conflict } from "../errors";
import type { ApplePushKeyModel } from "../models";

// -- Port -------------------------------------------------------------------

export interface ApplePushKeyRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly appleTeamId: string;
    readonly keyId: string;
    readonly r2Key: string;
    readonly wrappedDek: string;
    readonly vaultVersion: number;
    readonly createdAt: string;
    readonly updatedAt: string;
  }) => Effect.Effect<void, Conflict>;

  readonly listByOrg: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly ApplePushKeyModel[]>;

  readonly findById: (params: {
    readonly id: string;
  }) => Effect.Effect<ApplePushKeyModel, NotFound>;

  readonly delete: (params: {
    readonly id: string;
  }) => Effect.Effect<{ readonly r2Key: string | null }>;
}

export class ApplePushKeyRepo extends Context.Tag("api/ApplePushKeyRepo")<
  ApplePushKeyRepo,
  ApplePushKeyRepository
>() {}

// -- D1 Adapter -------------------------------------------------------------

const COLUMNS = [
  "id",
  "organization_id",
  "apple_team_id",
  "key_id",
  "r2_key",
  "wrapped_dek",
  "vault_version",
  "created_at",
  "updated_at",
] as const;

const toModel = (row: Selectable<ApplePushKeys>): ApplePushKeyModel => ({
  id: row.id,
  organizationId: row.organization_id,
  appleTeamId: row.apple_team_id,
  keyId: row.key_id,
  r2Key: row.r2_key,
  wrappedDek: row.wrapped_dek,
  vaultVersion: row.vault_version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const ApplePushKeyRepoLive = Layer.succeed(ApplePushKeyRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* d1RunWithUniqueCheck(
        async () =>
          db
            .insertInto("apple_push_keys")
            .values({
              id: params.id,
              organization_id: params.organizationId,
              apple_team_id: params.appleTeamId,
              key_id: params.keyId,
              r2_key: params.r2Key,
              wrapped_dek: params.wrappedDek,
              vault_version: params.vaultVersion,
              created_at: params.createdAt,
              updated_at: params.updatedAt,
            })
            .execute(),
        `Push key ${params.keyId} already uploaded`,
      );
    }),

  listByOrg: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("apple_push_keys")
          .select(COLUMNS)
          .where("organization_id", "=", params.organizationId)
          .orderBy("created_at", "desc")
          .execute(),
      );
      return rows.map(toModel);
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("apple_push_keys")
          .select(COLUMNS)
          .where("id", "=", params.id)
          .executeTakeFirst(),
      );
      if (row === undefined) {
        return yield* new NotFound({ message: "Push key not found" });
      }
      return toModel(row);
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .deleteFrom("apple_push_keys")
          .where("id", "=", params.id)
          .returning(["r2_key"])
          .executeTakeFirst(),
      );
      return { r2Key: toDbNull(row?.r2_key) };
    }),
});
