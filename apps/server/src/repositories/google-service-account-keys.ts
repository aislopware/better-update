import { toDbNull } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import type { Selectable } from "kysely";

import { kyselyDb } from "../cloudflare/db";
import { NotFound } from "../errors";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { GoogleServiceAccountKeys } from "../db/schema";
import type { Conflict } from "../errors";
import type { GoogleServiceAccountKeyModel } from "../models";

export interface GoogleServiceAccountKeyRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly clientEmail: string;
    readonly privateKeyId: string;
    readonly googleProjectId: string;
    readonly clientId: string | null;
    readonly r2Key: string;
    readonly wrappedDek: string;
    readonly vaultVersion: number;
    readonly createdAt: string;
    readonly updatedAt: string;
  }) => Effect.Effect<void, Conflict>;

  readonly listByOrg: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly GoogleServiceAccountKeyModel[]>;

  readonly findById: (params: {
    readonly id: string;
  }) => Effect.Effect<GoogleServiceAccountKeyModel, NotFound>;

  readonly delete: (params: {
    readonly id: string;
  }) => Effect.Effect<{ readonly r2Key: string | null }>;
}

export class GoogleServiceAccountKeyRepo extends Context.Tag("api/GoogleServiceAccountKeyRepo")<
  GoogleServiceAccountKeyRepo,
  GoogleServiceAccountKeyRepository
>() {}

// -- D1 Adapter -------------------------------------------------------------

const toModel = (row: Selectable<GoogleServiceAccountKeys>): GoogleServiceAccountKeyModel => ({
  id: row.id,
  organizationId: row.organization_id,
  clientEmail: row.client_email,
  privateKeyId: row.private_key_id,
  googleProjectId: row.google_project_id,
  clientId: row.client_id,
  r2Key: row.r2_key,
  wrappedDek: row.wrapped_dek,
  vaultVersion: row.vault_version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const GoogleServiceAccountKeyRepoLive = Layer.succeed(GoogleServiceAccountKeyRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* d1RunWithUniqueCheck(
        async () =>
          db
            .insertInto("google_service_account_keys")
            .values({
              id: params.id,
              organization_id: params.organizationId,
              client_email: params.clientEmail,
              private_key_id: params.privateKeyId,
              google_project_id: params.googleProjectId,
              client_id: params.clientId,
              r2_key: params.r2Key,
              wrapped_dek: params.wrappedDek,
              vault_version: params.vaultVersion,
              created_at: params.createdAt,
              updated_at: params.updatedAt,
            })
            .execute(),
        `Google service account key ${params.privateKeyId} already uploaded`,
      );
    }),

  listByOrg: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("google_service_account_keys")
          .selectAll()
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
          .selectFrom("google_service_account_keys")
          .selectAll()
          .where("id", "=", params.id)
          .executeTakeFirst(),
      );
      if (row === undefined) {
        return yield* new NotFound({ message: "Service account key not found" });
      }
      return toModel(row);
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const keyRow = yield* Effect.promise(async () =>
        db
          .selectFrom("google_service_account_keys")
          .select("r2_key")
          .where("id", "=", params.id)
          .executeTakeFirst(),
      );
      yield* Effect.promise(async () =>
        db.deleteFrom("google_service_account_keys").where("id", "=", params.id).execute(),
      );
      return { r2Key: toDbNull(keyRow?.r2_key) };
    }),
});
