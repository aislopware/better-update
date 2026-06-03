import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { Conflict } from "../errors";
import type { AndroidApplicationIdentifierModel } from "../models";

export interface AndroidApplicationIdentifierRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly packageName: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  }) => Effect.Effect<void, Conflict>;

  readonly listByProject: (params: {
    readonly projectId: string;
  }) => Effect.Effect<readonly AndroidApplicationIdentifierModel[]>;

  readonly findByProjectAndPackage: (params: {
    readonly projectId: string;
    readonly packageName: string;
  }) => Effect.Effect<AndroidApplicationIdentifierModel, NotFound>;

  readonly findById: (params: {
    readonly id: string;
  }) => Effect.Effect<AndroidApplicationIdentifierModel, NotFound>;

  readonly delete: (params: { readonly id: string }) => Effect.Effect<void>;
}

export class AndroidApplicationIdentifierRepo extends Context.Tag(
  "api/AndroidApplicationIdentifierRepo",
)<AndroidApplicationIdentifierRepo, AndroidApplicationIdentifierRepository>() {}

interface Row {
  id: string;
  organization_id: string;
  project_id: string;
  package_name: string;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `"id", "organization_id", "project_id", "package_name", "created_at", "updated_at"`;

const toModel = (row: Row): AndroidApplicationIdentifierModel => ({
  id: row.id,
  organizationId: row.organization_id,
  projectId: row.project_id,
  packageName: row.package_name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const AndroidApplicationIdentifierRepoLive = Layer.succeed(
  AndroidApplicationIdentifierRepo,
  {
    insert: (params) =>
      Effect.gen(function* () {
        const env = yield* cloudflareEnv;
        yield* d1RunWithUniqueCheck(
          async () =>
            env.DB.prepare(
              `INSERT INTO "android_application_identifiers" (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`,
            )
              .bind(
                params.id,
                params.organizationId,
                params.projectId,
                params.packageName,
                params.createdAt,
                params.updatedAt,
              )
              .run(),
          `Android application identifier ${params.packageName} already registered for this project`,
        );
      }),

    listByProject: (params) =>
      Effect.gen(function* () {
        const env = yield* cloudflareEnv;
        const rows = yield* Effect.promise(async () =>
          env.DB.prepare(
            `SELECT ${COLUMNS} FROM "android_application_identifiers" WHERE "project_id" = ? ORDER BY "package_name"`,
          )
            .bind(params.projectId)
            .all<Row>(),
        );
        return rows.results.map(toModel);
      }),

    findByProjectAndPackage: (params) =>
      Effect.gen(function* () {
        const env = yield* cloudflareEnv;
        const row = yield* Effect.promise(async () =>
          env.DB.prepare(
            `SELECT ${COLUMNS} FROM "android_application_identifiers" WHERE "project_id" = ? AND "package_name" = ?`,
          )
            .bind(params.projectId, params.packageName)
            .first<Row>(),
        );
        if (row === null) {
          return yield* new NotFound({
            message: `No Android application identifier registered for ${params.packageName}`,
          });
        }
        return toModel(row);
      }),

    findById: (params) =>
      Effect.gen(function* () {
        const env = yield* cloudflareEnv;
        const row = yield* Effect.promise(async () =>
          env.DB.prepare(`SELECT ${COLUMNS} FROM "android_application_identifiers" WHERE "id" = ?`)
            .bind(params.id)
            .first<Row>(),
        );
        if (row === null) {
          return yield* new NotFound({ message: "Android application identifier not found" });
        }
        return toModel(row);
      }),

    delete: (params) =>
      Effect.gen(function* () {
        const env = yield* cloudflareEnv;
        yield* Effect.promise(async () =>
          env.DB.prepare(`DELETE FROM "android_application_identifiers" WHERE "id" = ?`)
            .bind(params.id)
            .run(),
        );
      }),
  },
);
