import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { Conflict } from "../errors";
import type { DistributionType, IosBundleConfigurationModel } from "../models";

export interface IosBundleConfigurationRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly bundleIdentifier: string;
    readonly distributionType: DistributionType;
    readonly appleTeamId: string;
    readonly appleDistributionCertificateId: string | null;
    readonly appleProvisioningProfileId: string | null;
    readonly applePushKeyId: string | null;
    readonly ascApiKeyId: string | null;
    readonly targetName: string | null;
    readonly parentBundleIdentifier: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  }) => Effect.Effect<void, Conflict>;

  readonly listByProject: (params: {
    readonly projectId: string;
  }) => Effect.Effect<readonly IosBundleConfigurationModel[]>;

  readonly findByProjectAndBundle: (params: {
    readonly projectId: string;
    readonly bundleIdentifier: string;
    readonly distributionType: DistributionType;
  }) => Effect.Effect<IosBundleConfigurationModel, NotFound>;

  readonly findById: (params: {
    readonly id: string;
  }) => Effect.Effect<IosBundleConfigurationModel, NotFound>;

  readonly update: (params: {
    readonly id: string;
    readonly appleDistributionCertificateId?: string | null | undefined;
    readonly appleProvisioningProfileId?: string | null | undefined;
    readonly applePushKeyId?: string | null | undefined;
    readonly ascApiKeyId?: string | null | undefined;
    readonly targetName?: string | null | undefined;
    readonly parentBundleIdentifier?: string | null | undefined;
    readonly updatedAt: string;
  }) => Effect.Effect<void>;

  readonly delete: (params: { readonly id: string }) => Effect.Effect<void>;
}

export class IosBundleConfigurationRepo extends Context.Tag("api/IosBundleConfigurationRepo")<
  IosBundleConfigurationRepo,
  IosBundleConfigurationRepository
>() {}

interface Row {
  id: string;
  organization_id: string;
  project_id: string;
  bundle_identifier: string;
  distribution_type: DistributionType;
  apple_team_id: string;
  apple_distribution_certificate_id: string | null;
  apple_provisioning_profile_id: string | null;
  apple_push_key_id: string | null;
  asc_api_key_id: string | null;
  target_name: string | null;
  parent_bundle_identifier: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `"id", "organization_id", "project_id", "bundle_identifier", "distribution_type", "apple_team_id", "apple_distribution_certificate_id", "apple_provisioning_profile_id", "apple_push_key_id", "asc_api_key_id", "target_name", "parent_bundle_identifier", "created_at", "updated_at"`;

const toModel = (row: Row): IosBundleConfigurationModel => ({
  id: row.id,
  organizationId: row.organization_id,
  projectId: row.project_id,
  bundleIdentifier: row.bundle_identifier,
  distributionType: row.distribution_type,
  appleTeamId: row.apple_team_id,
  appleDistributionCertificateId: row.apple_distribution_certificate_id,
  appleProvisioningProfileId: row.apple_provisioning_profile_id,
  applePushKeyId: row.apple_push_key_id,
  ascApiKeyId: row.asc_api_key_id,
  targetName: row.target_name,
  parentBundleIdentifier: row.parent_bundle_identifier,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const IosBundleConfigurationRepoLive = Layer.succeed(IosBundleConfigurationRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* d1RunWithUniqueCheck(
        async () =>
          env.DB.prepare(
            `INSERT INTO "ios_bundle_configurations" (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
            .bind(
              params.id,
              params.organizationId,
              params.projectId,
              params.bundleIdentifier,
              params.distributionType,
              params.appleTeamId,
              params.appleDistributionCertificateId,
              params.appleProvisioningProfileId,
              params.applePushKeyId,
              params.ascApiKeyId,
              params.targetName,
              params.parentBundleIdentifier,
              params.createdAt,
              params.updatedAt,
            )
            .run(),
        `iOS bundle configuration already exists for ${params.bundleIdentifier} (${params.distributionType})`,
      );
    }),

  listByProject: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "ios_bundle_configurations" WHERE "project_id" = ? ORDER BY "bundle_identifier", "distribution_type"`,
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
          `SELECT ${COLUMNS} FROM "ios_bundle_configurations" WHERE "project_id" = ? AND "bundle_identifier" = ? AND "distribution_type" = ?`,
        )
          .bind(params.projectId, params.bundleIdentifier, params.distributionType)
          .first<Row>(),
      );
      if (row === null) {
        return yield* new NotFound({
          message: `No iOS bundle configuration found for ${params.bundleIdentifier} (${params.distributionType})`,
        });
      }
      return toModel(row);
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${COLUMNS} FROM "ios_bundle_configurations" WHERE "id" = ?`)
          .bind(params.id)
          .first<Row>(),
      );
      if (row === null) {
        return yield* new NotFound({ message: "iOS bundle configuration not found" });
      }
      return toModel(row);
    }),

  update: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const sets: string[] = [`"updated_at" = ?`];
      const bindings: (string | null)[] = [params.updatedAt];
      if (params.appleDistributionCertificateId !== undefined) {
        sets.push(`"apple_distribution_certificate_id" = ?`);
        bindings.push(params.appleDistributionCertificateId);
      }
      if (params.appleProvisioningProfileId !== undefined) {
        sets.push(`"apple_provisioning_profile_id" = ?`);
        bindings.push(params.appleProvisioningProfileId);
      }
      if (params.applePushKeyId !== undefined) {
        sets.push(`"apple_push_key_id" = ?`);
        bindings.push(params.applePushKeyId);
      }
      if (params.ascApiKeyId !== undefined) {
        sets.push(`"asc_api_key_id" = ?`);
        bindings.push(params.ascApiKeyId);
      }
      if (params.targetName !== undefined) {
        sets.push(`"target_name" = ?`);
        bindings.push(params.targetName);
      }
      if (params.parentBundleIdentifier !== undefined) {
        sets.push(`"parent_bundle_identifier" = ?`);
        bindings.push(params.parentBundleIdentifier);
      }
      bindings.push(params.id);
      yield* Effect.promise(async () =>
        env.DB.prepare(`UPDATE "ios_bundle_configurations" SET ${sets.join(", ")} WHERE "id" = ?`)
          .bind(...bindings)
          .run(),
      );
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.prepare(`DELETE FROM "ios_bundle_configurations" WHERE "id" = ?`)
          .bind(params.id)
          .run(),
      );
    }),
});
