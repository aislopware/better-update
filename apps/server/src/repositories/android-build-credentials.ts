import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";

import type { AndroidBuildCredentialsModel } from "../models";

export interface AndroidBuildCredentialsRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly androidApplicationIdentifierId: string;
    readonly androidUploadKeystoreId: string | null;
    readonly googleServiceAccountKeyForSubmissionsId: string | null;
    readonly googleServiceAccountKeyForFcmV1Id: string | null;
    readonly name: string;
    readonly isDefault: boolean;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly clearOtherDefaults?: boolean | undefined;
  }) => Effect.Effect<void>;

  readonly listByAppIdentifier: (params: {
    readonly androidApplicationIdentifierId: string;
  }) => Effect.Effect<readonly AndroidBuildCredentialsModel[]>;

  readonly findById: (params: {
    readonly id: string;
  }) => Effect.Effect<AndroidBuildCredentialsModel, NotFound>;

  readonly findByAppIdentifierAndName: (params: {
    readonly androidApplicationIdentifierId: string;
    readonly name: string;
  }) => Effect.Effect<AndroidBuildCredentialsModel | null>;

  readonly update: (params: {
    readonly id: string;
    readonly name?: string | undefined;
    readonly androidUploadKeystoreId?: string | null | undefined;
    readonly googleServiceAccountKeyForSubmissionsId?: string | null | undefined;
    readonly googleServiceAccountKeyForFcmV1Id?: string | null | undefined;
    readonly isDefault?: boolean | undefined;
    readonly updatedAt: string;
  }) => Effect.Effect<void>;

  readonly clearDefault: (params: {
    readonly androidApplicationIdentifierId: string;
    readonly exceptId: string;
  }) => Effect.Effect<void>;

  readonly delete: (params: { readonly id: string }) => Effect.Effect<void>;
}

export class AndroidBuildCredentialsRepo extends Context.Tag("api/AndroidBuildCredentialsRepo")<
  AndroidBuildCredentialsRepo,
  AndroidBuildCredentialsRepository
>() {}

interface Row {
  id: string;
  organization_id: string;
  android_application_identifier_id: string;
  android_upload_keystore_id: string | null;
  google_service_account_key_for_submissions_id: string | null;
  google_service_account_key_for_fcm_v1_id: string | null;
  name: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `"id", "organization_id", "android_application_identifier_id", "android_upload_keystore_id", "google_service_account_key_for_submissions_id", "google_service_account_key_for_fcm_v1_id", "name", "is_default", "created_at", "updated_at"`;

const toModel = (row: Row): AndroidBuildCredentialsModel => ({
  id: row.id,
  organizationId: row.organization_id,
  androidApplicationIdentifierId: row.android_application_identifier_id,
  androidUploadKeystoreId: row.android_upload_keystore_id,
  googleServiceAccountKeyForSubmissionsId: row.google_service_account_key_for_submissions_id,
  googleServiceAccountKeyForFcmV1Id: row.google_service_account_key_for_fcm_v1_id,
  name: row.name,
  isDefault: row.is_default === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const AndroidBuildCredentialsRepoLive = Layer.succeed(AndroidBuildCredentialsRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const insertStmt = env.DB.prepare(
        `INSERT INTO "android_build_credentials" (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        params.id,
        params.organizationId,
        params.androidApplicationIdentifierId,
        params.androidUploadKeystoreId,
        params.googleServiceAccountKeyForSubmissionsId,
        params.googleServiceAccountKeyForFcmV1Id,
        params.name,
        params.isDefault ? 1 : 0,
        params.createdAt,
        params.updatedAt,
      );
      if (params.clearOtherDefaults === true) {
        const clearStmt = env.DB.prepare(
          `UPDATE "android_build_credentials" SET "is_default" = 0 WHERE "android_application_identifier_id" = ? AND "id" <> ?`,
        ).bind(params.androidApplicationIdentifierId, params.id);
        yield* Effect.promise(async () => env.DB.batch([clearStmt, insertStmt]));
      } else {
        yield* Effect.promise(async () => insertStmt.run());
      }
    }),

  listByAppIdentifier: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "android_build_credentials" WHERE "android_application_identifier_id" = ? ORDER BY "is_default" DESC, "created_at" DESC`,
        )
          .bind(params.androidApplicationIdentifierId)
          .all<Row>(),
      );
      return rows.results.map(toModel);
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${COLUMNS} FROM "android_build_credentials" WHERE "id" = ?`)
          .bind(params.id)
          .first<Row>(),
      );
      if (row === null) {
        return yield* Effect.fail(new NotFound({ message: "Android build credentials not found" }));
      }
      return toModel(row);
    }),

  findByAppIdentifierAndName: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "android_build_credentials" WHERE "android_application_identifier_id" = ? AND "name" = ?`,
        )
          .bind(params.androidApplicationIdentifierId, params.name)
          .first<Row>(),
      );
      return row === null ? null : toModel(row);
    }),

  update: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const sets: string[] = [`"updated_at" = ?`];
      const bindings: (string | number | null)[] = [params.updatedAt];
      if (params.name !== undefined) {
        sets.push(`"name" = ?`);
        bindings.push(params.name);
      }
      if (params.androidUploadKeystoreId !== undefined) {
        sets.push(`"android_upload_keystore_id" = ?`);
        bindings.push(params.androidUploadKeystoreId);
      }
      if (params.googleServiceAccountKeyForSubmissionsId !== undefined) {
        sets.push(`"google_service_account_key_for_submissions_id" = ?`);
        bindings.push(params.googleServiceAccountKeyForSubmissionsId);
      }
      if (params.googleServiceAccountKeyForFcmV1Id !== undefined) {
        sets.push(`"google_service_account_key_for_fcm_v1_id" = ?`);
        bindings.push(params.googleServiceAccountKeyForFcmV1Id);
      }
      if (params.isDefault !== undefined) {
        sets.push(`"is_default" = ?`);
        bindings.push(params.isDefault ? 1 : 0);
      }
      bindings.push(params.id);
      yield* Effect.promise(async () =>
        env.DB.prepare(`UPDATE "android_build_credentials" SET ${sets.join(", ")} WHERE "id" = ?`)
          .bind(...bindings)
          .run(),
      );
    }),

  clearDefault: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.prepare(
          `UPDATE "android_build_credentials" SET "is_default" = 0 WHERE "android_application_identifier_id" = ? AND "id" <> ?`,
        )
          .bind(params.androidApplicationIdentifierId, params.exceptId)
          .run(),
      );
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.prepare(`DELETE FROM "android_build_credentials" WHERE "id" = ?`)
          .bind(params.id)
          .run(),
      );
    }),
});
