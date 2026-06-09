import { Context, Effect, Layer } from "effect";

import { kyselyDb } from "../cloudflare/db";
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

const COLUMNS = [
  "id",
  "organization_id",
  "project_id",
  "package_name",
  "created_at",
  "updated_at",
] as const;

const toModel = (row: {
  id: string | null;
  organization_id: string;
  project_id: string;
  package_name: string;
  created_at: string;
  updated_at: string;
}): AndroidApplicationIdentifierModel => ({
  // eslint-disable-next-line typescript/no-non-null-assertion -- id is always present; schema marks it nullable only due to codegen convention
  id: row.id!,
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
        const db = yield* kyselyDb;
        yield* d1RunWithUniqueCheck(
          async () =>
            db
              .insertInto("android_application_identifiers")
              .values({
                id: params.id,
                organization_id: params.organizationId,
                project_id: params.projectId,
                package_name: params.packageName,
                created_at: params.createdAt,
                updated_at: params.updatedAt,
              })
              .execute(),
          `Android application identifier ${params.packageName} already registered for this project`,
        );
      }),

    listByProject: (params) =>
      Effect.gen(function* () {
        const db = yield* kyselyDb;
        const rows = yield* Effect.promise(async () =>
          db
            .selectFrom("android_application_identifiers")
            .select(COLUMNS)
            .where("project_id", "=", params.projectId)
            .orderBy("package_name", "asc")
            .execute(),
        );
        return rows.map(toModel);
      }),

    findByProjectAndPackage: (params) =>
      Effect.gen(function* () {
        const db = yield* kyselyDb;
        const row = yield* Effect.promise(async () =>
          db
            .selectFrom("android_application_identifiers")
            .select(COLUMNS)
            .where("project_id", "=", params.projectId)
            .where("package_name", "=", params.packageName)
            .executeTakeFirst(),
        );
        if (row === undefined) {
          return yield* new NotFound({
            message: `No Android application identifier registered for ${params.packageName}`,
          });
        }
        return toModel(row);
      }),

    findById: (params) =>
      Effect.gen(function* () {
        const db = yield* kyselyDb;
        const row = yield* Effect.promise(async () =>
          db
            .selectFrom("android_application_identifiers")
            .select(COLUMNS)
            .where("id", "=", params.id)
            .executeTakeFirst(),
        );
        if (row === undefined) {
          return yield* new NotFound({ message: "Android application identifier not found" });
        }
        return toModel(row);
      }),

    delete: (params) =>
      Effect.gen(function* () {
        const db = yield* kyselyDb;
        yield* Effect.promise(async () =>
          db.deleteFrom("android_application_identifiers").where("id", "=", params.id).execute(),
        );
      }),
  },
);
