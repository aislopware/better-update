import { toDbNull } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import type { Selectable } from "kysely";

import { kyselyDb } from "../cloudflare/db";
import { NotFound } from "../errors";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { AscApiKeys } from "../db/schema";
import type { Conflict } from "../errors";
import type { AscApiKeyModel } from "../models";

export interface AscApiKeyRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly appleTeamId: string | null;
    readonly keyId: string;
    readonly issuerId: string;
    readonly name: string;
    readonly roles: string;
    readonly r2Key: string;
    readonly wrappedDek: string;
    readonly vaultVersion: number;
    readonly createdAt: string;
    readonly updatedAt: string;
  }) => Effect.Effect<void, Conflict>;

  readonly listByOrg: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly AscApiKeyModel[]>;

  readonly listByOrgAndTeam: (params: {
    readonly organizationId: string;
    readonly appleTeamId: string;
  }) => Effect.Effect<readonly AscApiKeyModel[]>;

  readonly findById: (params: { readonly id: string }) => Effect.Effect<AscApiKeyModel, NotFound>;

  readonly delete: (params: {
    readonly id: string;
  }) => Effect.Effect<{ readonly r2Key: string | null }>;
}

export class AscApiKeyRepo extends Context.Tag("api/AscApiKeyRepo")<
  AscApiKeyRepo,
  AscApiKeyRepository
>() {}

// -- D1 Adapter -------------------------------------------------------------

const COLUMNS = [
  "id",
  "organization_id",
  "apple_team_id",
  "key_id",
  "issuer_id",
  "name",
  "roles",
  "r2_key",
  "wrapped_dek",
  "vault_version",
  "created_at",
  "updated_at",
] as const;

const toModel = (row: Selectable<AscApiKeys>): AscApiKeyModel => ({
  id: row.id,
  organizationId: row.organization_id,
  appleTeamId: row.apple_team_id,
  keyId: row.key_id,
  issuerId: row.issuer_id,
  name: row.name,
  roles: row.roles,
  r2Key: row.r2_key,
  wrappedDek: row.wrapped_dek,
  vaultVersion: row.vault_version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const AscApiKeyRepoLive = Layer.succeed(AscApiKeyRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* d1RunWithUniqueCheck(
        async () =>
          db
            .insertInto("asc_api_keys")
            .values({
              id: params.id,
              organization_id: params.organizationId,
              apple_team_id: params.appleTeamId,
              key_id: params.keyId,
              issuer_id: params.issuerId,
              name: params.name,
              roles: params.roles,
              r2_key: params.r2Key,
              wrapped_dek: params.wrappedDek,
              vault_version: params.vaultVersion,
              created_at: params.createdAt,
              updated_at: params.updatedAt,
            })
            .execute(),
        `ASC API key ${params.keyId} already uploaded`,
      );
    }),

  listByOrg: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("asc_api_keys")
          .select(COLUMNS)
          .where("organization_id", "=", params.organizationId)
          .orderBy("created_at", "desc")
          .execute(),
      );
      return rows.map(toModel);
    }),

  listByOrgAndTeam: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("asc_api_keys")
          .select(COLUMNS)
          .where("organization_id", "=", params.organizationId)
          .where("apple_team_id", "=", params.appleTeamId)
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
          .selectFrom("asc_api_keys")
          .select(COLUMNS)
          .where("id", "=", params.id)
          .executeTakeFirst(),
      );
      if (row === undefined) {
        return yield* new NotFound({ message: "ASC API key not found" });
      }
      return toModel(row);
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const keyRow = yield* Effect.promise(async () =>
        db
          .selectFrom("asc_api_keys")
          .select(["r2_key"])
          .where("id", "=", params.id)
          .executeTakeFirst(),
      );
      yield* Effect.promise(async () =>
        db.deleteFrom("asc_api_keys").where("id", "=", params.id).execute(),
      );
      return { r2Key: toDbNull(keyRow?.r2_key) };
    }),
});
