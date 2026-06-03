import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";
import { d1RunWithUniqueCheck } from "./d1-helpers";

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

interface Row {
  id: string;
  organization_id: string;
  project_id: string;
  bundle_identifier: string;
  asc_app_id: string | null;
  sku: string | null;
  language: string;
  company_name: string | null;
  app_name: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `"id", "organization_id", "project_id", "bundle_identifier", "asc_app_id", "sku", "language", "company_name", "app_name", "created_at", "updated_at"`;

const toModel = (row: Row): IosAppMetadataModel => ({
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
      const env = yield* cloudflareEnv;
      yield* d1RunWithUniqueCheck(
        async () =>
          env.DB.prepare(
            `INSERT INTO "ios_app_metadata" (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
            .bind(
              params.id,
              params.organizationId,
              params.projectId,
              params.bundleIdentifier,
              params.ascAppId,
              params.sku,
              params.language,
              params.companyName,
              params.appName,
              params.createdAt,
              params.updatedAt,
            )
            .run(),
        `iOS App Store metadata already exists for ${params.bundleIdentifier}`,
      );
    }),

  listByProject: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "ios_app_metadata" WHERE "project_id" = ? ORDER BY "bundle_identifier"`,
        )
          .bind(params.projectId)
          .all<Row>(),
      );
      return rows.results.map(toModel);
    }),

  findByProjectAndBundle: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "ios_app_metadata" WHERE "project_id" = ? AND "bundle_identifier" = ?`,
        )
          .bind(params.projectId, params.bundleIdentifier)
          .first<Row>(),
      );
      if (row === null) {
        return yield* new NotFound({
          message: `No iOS App Store metadata found for ${params.bundleIdentifier}`,
        });
      }
      return toModel(row);
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${COLUMNS} FROM "ios_app_metadata" WHERE "id" = ?`)
          .bind(params.id)
          .first<Row>(),
      );
      if (row === null) {
        return yield* new NotFound({ message: "iOS App Store metadata not found" });
      }
      return toModel(row);
    }),

  update: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const sets: string[] = [`"updated_at" = ?`];
      const bindings: (string | null)[] = [params.updatedAt];
      if (params.ascAppId !== undefined) {
        sets.push(`"asc_app_id" = ?`);
        bindings.push(params.ascAppId);
      }
      if (params.sku !== undefined) {
        sets.push(`"sku" = ?`);
        bindings.push(params.sku);
      }
      if (params.language !== undefined) {
        sets.push(`"language" = ?`);
        bindings.push(params.language);
      }
      if (params.companyName !== undefined) {
        sets.push(`"company_name" = ?`);
        bindings.push(params.companyName);
      }
      if (params.appName !== undefined) {
        sets.push(`"app_name" = ?`);
        bindings.push(params.appName);
      }
      bindings.push(params.id);
      yield* Effect.promise(async () =>
        env.DB.prepare(`UPDATE "ios_app_metadata" SET ${sets.join(", ")} WHERE "id" = ?`)
          .bind(...bindings)
          .run(),
      );
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.prepare(`DELETE FROM "ios_app_metadata" WHERE "id" = ?`).bind(params.id).run(),
      );
    }),
});
