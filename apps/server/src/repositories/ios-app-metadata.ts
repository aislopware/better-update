import { compact } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import type { Selectable } from "kysely";

import { kyselyDb } from "../cloudflare/db";
import { NotFound } from "../errors";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { IosAppMetadata } from "../db/schema";
import type { Conflict } from "../errors";
import type { IosAppMetadataModel } from "../submission-models";

export interface IosAppMetadataRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly bundleIdentifier: string;
    readonly ascAppId: string | null;
    readonly sku: string | null;
    readonly language: string;
    readonly companyName: string | null;
    readonly appName: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  }) => Effect.Effect<void, Conflict>;

  readonly listByProject: (params: {
    readonly projectId: string;
  }) => Effect.Effect<readonly IosAppMetadataModel[]>;

  readonly findByProjectAndBundle: (params: {
    readonly projectId: string;
    readonly bundleIdentifier: string;
  }) => Effect.Effect<IosAppMetadataModel, NotFound>;

  readonly findById: (params: {
    readonly id: string;
  }) => Effect.Effect<IosAppMetadataModel, NotFound>;

  readonly update: (params: {
    readonly id: string;
    readonly ascAppId?: string | null | undefined;
    readonly sku?: string | null | undefined;
    readonly language?: string | undefined;
    readonly companyName?: string | null | undefined;
    readonly appName?: string | null | undefined;
    readonly updatedAt: string;
  }) => Effect.Effect<void>;

  readonly delete: (params: { readonly id: string }) => Effect.Effect<void>;
}

export class IosAppMetadataRepo extends Context.Tag("api/IosAppMetadataRepo")<
  IosAppMetadataRepo,
  IosAppMetadataRepository
>() {}

// -- D1 Adapter -------------------------------------------------------------

const toModel = (row: Selectable<IosAppMetadata>): IosAppMetadataModel => ({
  id: row.id,
  organizationId: row.organization_id,
  projectId: row.project_id,
  bundleIdentifier: row.bundle_identifier,
  ascAppId: row.asc_app_id,
  sku: row.sku,
  language: row.language,
  companyName: row.company_name,
  appName: row.app_name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const IosAppMetadataRepoLive = Layer.succeed(IosAppMetadataRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* d1RunWithUniqueCheck(
        async () =>
          db
            .insertInto("ios_app_metadata")
            .values({
              id: params.id,
              organization_id: params.organizationId,
              project_id: params.projectId,
              bundle_identifier: params.bundleIdentifier,
              asc_app_id: params.ascAppId,
              sku: params.sku,
              language: params.language,
              company_name: params.companyName,
              app_name: params.appName,
              created_at: params.createdAt,
              updated_at: params.updatedAt,
            })
            .execute(),
        `iOS App Store metadata already exists for ${params.bundleIdentifier}`,
      );
    }),

  listByProject: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("ios_app_metadata")
          .selectAll()
          .where("project_id", "=", params.projectId)
          .orderBy("bundle_identifier")
          .execute(),
      );
      return rows.map(toModel);
    }),

  findByProjectAndBundle: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("ios_app_metadata")
          .selectAll()
          .where("project_id", "=", params.projectId)
          .where("bundle_identifier", "=", params.bundleIdentifier)
          .executeTakeFirst(),
      );
      if (row === undefined) {
        return yield* new NotFound({
          message: `No iOS App Store metadata found for ${params.bundleIdentifier}`,
        });
      }
      return toModel(row);
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("ios_app_metadata")
          .selectAll()
          .where("id", "=", params.id)
          .executeTakeFirst(),
      );
      if (row === undefined) {
        return yield* new NotFound({ message: "iOS App Store metadata not found" });
      }
      return toModel(row);
    }),

  update: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const patch = compact({
        updated_at: params.updatedAt,
        asc_app_id: params.ascAppId,
        sku: params.sku,
        language: params.language,
        company_name: params.companyName,
        app_name: params.appName,
      });
      yield* Effect.promise(async () =>
        db.updateTable("ios_app_metadata").set(patch).where("id", "=", params.id).execute(),
      );
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db.deleteFrom("ios_app_metadata").where("id", "=", params.id).execute(),
      );
    }),
});
