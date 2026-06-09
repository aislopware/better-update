import { toDbNull } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import type { Selectable } from "kysely";

import { kyselyDb } from "../cloudflare/db";
import { NotFound } from "../errors";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { AndroidUploadKeystores } from "../db/schema";
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
    readonly keystoreType: "JKS" | "PKCS12" | null;
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

// -- D1 Adapter -------------------------------------------------------------

const COLUMNS = [
  "id",
  "organization_id",
  "key_alias",
  "r2_key",
  "wrapped_dek",
  "vault_version",
  "md5_fingerprint",
  "sha1_fingerprint",
  "sha256_fingerprint",
  "keystore_type",
  "created_at",
  "updated_at",
] as const;

const toModel = (row: Selectable<AndroidUploadKeystores>): AndroidUploadKeystoreModel => ({
  id: row.id,
  organizationId: row.organization_id,
  keyAlias: row.key_alias,
  r2Key: row.r2_key,
  wrappedDek: row.wrapped_dek,
  vaultVersion: row.vault_version,
  md5Fingerprint: row.md5_fingerprint,
  sha1Fingerprint: row.sha1_fingerprint,
  sha256Fingerprint: row.sha256_fingerprint,
  keystoreType: row.keystore_type,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const AndroidUploadKeystoreRepoLive = Layer.succeed(AndroidUploadKeystoreRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* d1RunWithUniqueCheck(
        async () =>
          db
            .insertInto("android_upload_keystores")
            .values({
              id: params.id,
              organization_id: params.organizationId,
              key_alias: params.keyAlias,
              r2_key: params.r2Key,
              wrapped_dek: params.wrappedDek,
              vault_version: params.vaultVersion,
              md5_fingerprint: params.md5Fingerprint,
              sha1_fingerprint: params.sha1Fingerprint,
              sha256_fingerprint: params.sha256Fingerprint,
              keystore_type: params.keystoreType,
              created_at: params.createdAt,
              updated_at: params.updatedAt,
            })
            .execute(),
        "This keystore has already been uploaded",
      );
    }),

  listByOrg: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("android_upload_keystores")
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
          .selectFrom("android_upload_keystores")
          .select(COLUMNS)
          .where("id", "=", params.id)
          .executeTakeFirst(),
      );
      if (row === undefined) {
        return yield* new NotFound({ message: "Android keystore not found" });
      }
      return toModel(row);
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .deleteFrom("android_upload_keystores")
          .where("id", "=", params.id)
          .returning(["r2_key"])
          .executeTakeFirst(),
      );
      return { r2Key: toDbNull(row?.r2_key) };
    }),
});
