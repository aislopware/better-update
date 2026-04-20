import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";
import { toDbNull } from "../lib/nullable";

import type { AndroidUploadKeystoreModel } from "../models";

export interface AndroidUploadKeystoreRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly keyAlias: string;
    readonly encryptedKeystorePassword: string;
    readonly keystorePasswordKeyVersion: number;
    readonly encryptedKeyPassword: string;
    readonly keyPasswordKeyVersion: number;
    readonly r2Key: string;
    readonly encryptedDek: string;
    readonly dekKeyVersion: number;
    readonly md5Fingerprint: string | null;
    readonly sha1Fingerprint: string | null;
    readonly sha256Fingerprint: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  }) => Effect.Effect<void>;

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
  encrypted_keystore_password: string;
  keystore_password_key_version: number;
  encrypted_key_password: string;
  key_password_key_version: number;
  r2_key: string;
  encrypted_dek: string;
  dek_key_version: number;
  md5_fingerprint: string | null;
  sha1_fingerprint: string | null;
  sha256_fingerprint: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `"id", "organization_id", "key_alias", "encrypted_keystore_password", "keystore_password_key_version", "encrypted_key_password", "key_password_key_version", "r2_key", "encrypted_dek", "dek_key_version", "md5_fingerprint", "sha1_fingerprint", "sha256_fingerprint", "created_at", "updated_at"`;

const toModel = (row: Row): AndroidUploadKeystoreModel => ({
  id: row.id,
  organizationId: row.organization_id,
  keyAlias: row.key_alias,
  encryptedKeystorePassword: row.encrypted_keystore_password,
  keystorePasswordKeyVersion: row.keystore_password_key_version,
  encryptedKeyPassword: row.encrypted_key_password,
  keyPasswordKeyVersion: row.key_password_key_version,
  r2Key: row.r2_key,
  encryptedDek: row.encrypted_dek,
  dekKeyVersion: row.dek_key_version,
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
      yield* Effect.promise(async () =>
        env.DB.prepare(
          `INSERT INTO "android_upload_keystores" (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            params.id,
            params.organizationId,
            params.keyAlias,
            params.encryptedKeystorePassword,
            params.keystorePasswordKeyVersion,
            params.encryptedKeyPassword,
            params.keyPasswordKeyVersion,
            params.r2Key,
            params.encryptedDek,
            params.dekKeyVersion,
            params.md5Fingerprint,
            params.sha1Fingerprint,
            params.sha256Fingerprint,
            params.createdAt,
            params.updatedAt,
          )
          .run(),
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
        return yield* Effect.fail(new NotFound({ message: "Android keystore not found" }));
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
