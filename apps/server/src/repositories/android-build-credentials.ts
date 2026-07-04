import { compact } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import type { Selectable } from "kysely";

import { d1Session } from "../cloudflare/context";
import { kyselyDb } from "../cloudflare/db";
import { NotFound } from "../errors";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { AndroidBuildCredentials } from "../db/schema";
import type { Conflict } from "../errors";
import type { AndroidBuildCredentialsModel } from "../models";

/** Group joined to its app identifier's project — binding-plan input (§3c). */
export interface AndroidBuildCredentialsWithProject extends AndroidBuildCredentialsModel {
  readonly projectId: string;
}

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
  }) => Effect.Effect<void, Conflict>;

  readonly listByAppIdentifier: (params: {
    readonly androidApplicationIdentifierId: string;
  }) => Effect.Effect<readonly AndroidBuildCredentialsModel[]>;

  /** Every group in the org with its project id — binding-plan input. */
  readonly listByOrgWithProject: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly AndroidBuildCredentialsWithProject[]>;

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

// -- D1 Adapter -------------------------------------------------------------

const COLUMNS = [
  "id",
  "organization_id",
  "android_application_identifier_id",
  "android_upload_keystore_id",
  "google_service_account_key_for_submissions_id",
  "google_service_account_key_for_fcm_v1_id",
  "name",
  "is_default",
  "created_at",
  "updated_at",
] as const;

const toModel = (row: Selectable<AndroidBuildCredentials>): AndroidBuildCredentialsModel => ({
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
      const db = yield* kyselyDb;
      const session = yield* d1Session;

      const insertQuery = db.insertInto("android_build_credentials").values({
        id: params.id,
        organization_id: params.organizationId,
        android_application_identifier_id: params.androidApplicationIdentifierId,
        android_upload_keystore_id: params.androidUploadKeystoreId,
        google_service_account_key_for_submissions_id:
          params.googleServiceAccountKeyForSubmissionsId,
        google_service_account_key_for_fcm_v1_id: params.googleServiceAccountKeyForFcmV1Id,
        name: params.name,
        is_default: params.isDefault ? 1 : 0,
        created_at: params.createdAt,
        updated_at: params.updatedAt,
      });

      // A duplicate (app identifier, name) — or a second default — is a clean
      // Conflict, not a defect. Map the D1 UNIQUE rejection to a typed 409 so
      // callers get a real error instead of an opaque 500. When promoting this
      // group to default we clear any prior default first; the clear + insert
      // run as one atomic D1 batch (D1 has no interactive transactions) so a
      // name collision rolls the clear back too. d1Batch can't carry the typed
      // Conflict, so the batch is routed through the unique-check helper here.
      yield* d1RunWithUniqueCheck(async () => {
        if (params.clearOtherDefaults === true) {
          const clearQuery = db
            .updateTable("android_build_credentials")
            .set({ is_default: 0 })
            .where("android_application_identifier_id", "=", params.androidApplicationIdentifierId)
            .where("id", "<>", params.id);
          const statements = [clearQuery, insertQuery].map((query) => {
            const { sql, parameters } = query.compile();
            return session.prepare(sql).bind(...parameters);
          });
          return session.batch(statements);
        }
        return insertQuery.execute();
      }, "A build credentials group with this name already exists for this app identifier");
    }),

  listByAppIdentifier: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("android_build_credentials")
          .select(COLUMNS)
          .where("android_application_identifier_id", "=", params.androidApplicationIdentifierId)
          .orderBy("is_default", "desc")
          .orderBy("created_at", "desc")
          .execute(),
      );
      return rows.map(toModel);
    }),

  listByOrgWithProject: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("android_build_credentials as abc")
          .innerJoin(
            "android_application_identifiers as aai",
            "aai.id",
            "abc.android_application_identifier_id",
          )
          .select([
            "abc.id",
            "abc.organization_id",
            "abc.android_application_identifier_id",
            "abc.android_upload_keystore_id",
            "abc.google_service_account_key_for_submissions_id",
            "abc.google_service_account_key_for_fcm_v1_id",
            "abc.name",
            "abc.is_default",
            "abc.created_at",
            "abc.updated_at",
            "aai.project_id",
          ])
          .where("abc.organization_id", "=", params.organizationId)
          .orderBy("aai.project_id", "asc")
          .orderBy("abc.name", "asc")
          .execute(),
      );
      return rows.map((row) => Object.assign(toModel(row), { projectId: row.project_id }));
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("android_build_credentials")
          .select(COLUMNS)
          .where("id", "=", params.id)
          .executeTakeFirst(),
      );
      if (row === undefined) {
        return yield* new NotFound({ message: "Android build credentials not found" });
      }
      return toModel(row);
    }),

  findByAppIdentifierAndName: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("android_build_credentials")
          .select(COLUMNS)
          .where("android_application_identifier_id", "=", params.androidApplicationIdentifierId)
          .where("name", "=", params.name)
          .executeTakeFirst(),
      );
      return row === undefined ? null : toModel(row);
    }),

  update: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const patch = compact({
        updated_at: params.updatedAt,
        name: params.name,
        android_upload_keystore_id: params.androidUploadKeystoreId,
        google_service_account_key_for_submissions_id:
          params.googleServiceAccountKeyForSubmissionsId,
        google_service_account_key_for_fcm_v1_id: params.googleServiceAccountKeyForFcmV1Id,
        is_default: params.isDefault === undefined ? undefined : Number(params.isDefault),
      });
      yield* Effect.promise(async () =>
        db
          .updateTable("android_build_credentials")
          .set(patch)
          .where("id", "=", params.id)
          .execute(),
      );
    }),

  clearDefault: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .updateTable("android_build_credentials")
          .set({ is_default: 0 })
          .where("android_application_identifier_id", "=", params.androidApplicationIdentifierId)
          .where("id", "<>", params.exceptId)
          .execute(),
      );
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db.deleteFrom("android_build_credentials").where("id", "=", params.id).execute(),
      );
    }),
});
