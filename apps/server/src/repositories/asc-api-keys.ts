import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";
import { toDbNull } from "../lib/nullable";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { Conflict } from "../errors";
import type { AscApiKeyModel } from "../models";

export interface AscApiKeyRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly appleTeamId: string | null;
    readonly keyId: string;
    readonly name: string;
    readonly roles: string;
    readonly issuerIdEncrypted: string;
    readonly issuerIdKeyVersion: number;
    readonly r2Key: string;
    readonly encryptedDek: string;
    readonly dekKeyVersion: number;
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

interface Row {
  id: string;
  organization_id: string;
  apple_team_id: string | null;
  key_id: string;
  name: string;
  roles: string;
  issuer_id_encrypted: string;
  issuer_id_key_version: number;
  r2_key: string;
  encrypted_dek: string;
  dek_key_version: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `"id", "organization_id", "apple_team_id", "key_id", "name", "roles", "issuer_id_encrypted", "issuer_id_key_version", "r2_key", "encrypted_dek", "dek_key_version", "created_at", "updated_at"`;

const toModel = (row: Row): AscApiKeyModel => ({
  id: row.id,
  organizationId: row.organization_id,
  appleTeamId: row.apple_team_id,
  keyId: row.key_id,
  name: row.name,
  roles: row.roles,
  issuerIdEncrypted: row.issuer_id_encrypted,
  issuerIdKeyVersion: row.issuer_id_key_version,
  r2Key: row.r2_key,
  encryptedDek: row.encrypted_dek,
  dekKeyVersion: row.dek_key_version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const AscApiKeyRepoLive = Layer.succeed(AscApiKeyRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* d1RunWithUniqueCheck(
        async () =>
          env.DB.prepare(
            `INSERT INTO "asc_api_keys" (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
            .bind(
              params.id,
              params.organizationId,
              params.appleTeamId,
              params.keyId,
              params.name,
              params.roles,
              params.issuerIdEncrypted,
              params.issuerIdKeyVersion,
              params.r2Key,
              params.encryptedDek,
              params.dekKeyVersion,
              params.createdAt,
              params.updatedAt,
            )
            .run(),
        `ASC API key ${params.keyId} already uploaded`,
      );
    }),

  listByOrg: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "asc_api_keys" WHERE "organization_id" = ? ORDER BY "created_at" DESC`,
        )
          .bind(params.organizationId)
          .all<Row>(),
      );
      return rows.results.map(toModel);
    }),

  listByOrgAndTeam: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "asc_api_keys" WHERE "organization_id" = ? AND "apple_team_id" = ? ORDER BY "created_at" DESC`,
        )
          .bind(params.organizationId, params.appleTeamId)
          .all<Row>(),
      );
      return rows.results.map(toModel);
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${COLUMNS} FROM "asc_api_keys" WHERE "id" = ?`)
          .bind(params.id)
          .first<Row>(),
      );
      if (row === null) {
        return yield* Effect.fail(new NotFound({ message: "ASC API key not found" }));
      }
      return toModel(row);
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const keyRow = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT "r2_key" FROM "asc_api_keys" WHERE "id" = ?`)
          .bind(params.id)
          .first<{ r2_key: string }>(),
      );
      yield* Effect.promise(async () =>
        env.DB.prepare(`DELETE FROM "asc_api_keys" WHERE "id" = ?`).bind(params.id).run(),
      );
      return { r2Key: toDbNull(keyRow?.r2_key) };
    }),
});
