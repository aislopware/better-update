import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";
import { toDbNull } from "../lib/nullable";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { Conflict } from "../errors";
import type { AndroidUploadKeystoreModel } from "../models";

export interface AndroidUploadKeystoreRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly keyAlias: string;
    readonly r2Key: string;
    readonly wrappedDek: string;
    readonly vaultVersion: number;
    readonly md5Fingerprint: string | null;
    readonly sha1Fingerprint: string | null;
    readonly sha256Fingerprint: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  }) => Effect.Effect<void, Conflict>;

  readonly listByOrg: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly AndroidUploadKeystoreModel[]>;

  readonly findById: (params: {
    readonly id: string;
  }) => Effect.Effect<AndroidUploadKeystoreModel, NotFound>;

  readonly delete: (params: {
    readonly id: string;
  }) => Effect.Effect<{ readonly r2Key: string | null }>;
}

export class AndroidUploadKeystoreRepo extends Context.Tag("api/AndroidUploadKeystoreRepo")<
  AndroidUploadKeystoreRepo,
  AndroidUploadKeystoreRepository
>() {}

interface Row {
  id: string;
  organization_id: string;
  key_alias: string;
  r2_key: string;
  wrapped_dek: string;
  vault_version: number;
  md5_fingerprint: string | null;
  sha1_fingerprint: string | null;
  sha256_fingerprint: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `"id", "organization_id", "key_alias", "r2_key", "wrapped_dek", "vault_version", "md5_fingerprint", "sha1_fingerprint", "sha256_fingerprint", "created_at", "updated_at"`;

const toModel = (row: Row): AndroidUploadKeystoreModel => ({
  id: row.id,
  organizationId: row.organization_id,
  keyAlias: row.key_alias,
  r2Key: row.r2_key,
  wrappedDek: row.wrapped_dek,
  vaultVersion: row.vault_version,
  md5Fingerprint: row.md5_fingerprint,
  sha1Fingerprint: row.sha1_fingerprint,
  sha256Fingerprint: row.sha256_fingerprint,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const AndroidUploadKeystoreRepoLive = Layer.succeed(AndroidUploadKeystoreRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* d1RunWithUniqueCheck(
        async () =>
          env.DB.prepare(
            `INSERT INTO "android_upload_keystores" (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
            .bind(
              params.id,
              params.organizationId,
              params.keyAlias,
              params.r2Key,
              params.wrappedDek,
              params.vaultVersion,
              params.md5Fingerprint,
              params.sha1Fingerprint,
              params.sha256Fingerprint,
              params.createdAt,
              params.updatedAt,
            )
            .run(),
        "This keystore has already been uploaded",
      );
    }),

  listByOrg: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "android_upload_keystores" WHERE "organization_id" = ? ORDER BY "created_at" DESC`,
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
        env.DB.prepare(`SELECT ${COLUMNS} FROM "android_upload_keystores" WHERE "id" = ?`)
          .bind(params.id)
          .first<Row>(),
      );
      if (row === null) {
        return yield* new NotFound({ message: "Android keystore not found" });
      }
      return toModel(row);
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const keyRow = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT "r2_key" FROM "android_upload_keystores" WHERE "id" = ?`)
          .bind(params.id)
          .first<{ r2_key: string }>(),
      );
      yield* Effect.promise(async () =>
        env.DB.prepare(`DELETE FROM "android_upload_keystores" WHERE "id" = ?`)
          .bind(params.id)
          .run(),
      );
      return { r2Key: toDbNull(keyRow?.r2_key) };
    }),
});
