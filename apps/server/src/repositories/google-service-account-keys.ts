import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";
import { toDbNull } from "../lib/nullable";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { Conflict } from "../errors";
import type { GoogleServiceAccountKeyModel } from "../models";

export interface GoogleServiceAccountKeyRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly clientEmail: string;
    readonly privateKeyId: string;
    readonly googleProjectId: string;
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

interface Row {
  id: string;
  organization_id: string;
  client_email: string;
  private_key_id: string;
  google_project_id: string;
  r2_key: string;
  wrapped_dek: string;
  vault_version: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `"id", "organization_id", "client_email", "private_key_id", "google_project_id", "r2_key", "wrapped_dek", "vault_version", "created_at", "updated_at"`;

const toModel = (row: Row): GoogleServiceAccountKeyModel => ({
  id: row.id,
  organizationId: row.organization_id,
  clientEmail: row.client_email,
  privateKeyId: row.private_key_id,
  googleProjectId: row.google_project_id,
  r2Key: row.r2_key,
  wrappedDek: row.wrapped_dek,
  vaultVersion: row.vault_version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const GoogleServiceAccountKeyRepoLive = Layer.succeed(GoogleServiceAccountKeyRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* d1RunWithUniqueCheck(
        async () =>
          env.DB.prepare(
            `INSERT INTO "google_service_account_keys" (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
            .bind(
              params.id,
              params.organizationId,
              params.clientEmail,
              params.privateKeyId,
              params.googleProjectId,
              params.r2Key,
              params.wrappedDek,
              params.vaultVersion,
              params.createdAt,
              params.updatedAt,
            )
            .run(),
        `Google service account key ${params.privateKeyId} already uploaded`,
      );
    }),

  listByOrg: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "google_service_account_keys" WHERE "organization_id" = ? ORDER BY "created_at" DESC`,
        )
          .bind(params.organizationId)
          .all<Row>(),
      );
      return rows.results.map(toModel);
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${COLUMNS} FROM "google_service_account_keys" WHERE "id" = ?`)
          .bind(params.id)
          .first<Row>(),
      );
      if (row === null) {
        return yield* Effect.fail(new NotFound({ message: "Service account key not found" }));
      }
      return toModel(row);
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const keyRow = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT "r2_key" FROM "google_service_account_keys" WHERE "id" = ?`)
          .bind(params.id)
          .first<{ r2_key: string }>(),
      );
      yield* Effect.promise(async () =>
        env.DB.prepare(`DELETE FROM "google_service_account_keys" WHERE "id" = ?`)
          .bind(params.id)
          .run(),
      );
      return { r2Key: toDbNull(keyRow?.r2_key) };
    }),
});
