import { compact } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import type { Selectable } from "kysely";

import { kyselyDb } from "../cloudflare/db";
import { NotFound } from "../errors";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { IosBundleConfigurations } from "../db/schema";
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

// -- D1 Adapter -------------------------------------------------------------

const COLUMNS = [
  "id",
  "organization_id",
  "project_id",
  "bundle_identifier",
  "distribution_type",
  "apple_team_id",
  "apple_distribution_certificate_id",
  "apple_provisioning_profile_id",
  "apple_push_key_id",
  "asc_api_key_id",
  "target_name",
  "parent_bundle_identifier",
  "created_at",
  "updated_at",
] as const;

const toModel = (row: Selectable<IosBundleConfigurations>): IosBundleConfigurationModel => ({
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
      const db = yield* kyselyDb;
      yield* d1RunWithUniqueCheck(
        async () =>
          db
            .insertInto("ios_bundle_configurations")
            .values({
              id: params.id,
              organization_id: params.organizationId,
              project_id: params.projectId,
              bundle_identifier: params.bundleIdentifier,
              distribution_type: params.distributionType,
              apple_team_id: params.appleTeamId,
              apple_distribution_certificate_id: params.appleDistributionCertificateId,
              apple_provisioning_profile_id: params.appleProvisioningProfileId,
              apple_push_key_id: params.applePushKeyId,
              asc_api_key_id: params.ascApiKeyId,
              target_name: params.targetName,
              parent_bundle_identifier: params.parentBundleIdentifier,
              created_at: params.createdAt,
              updated_at: params.updatedAt,
            })
            .execute(),
        `iOS bundle configuration already exists for ${params.bundleIdentifier} (${params.distributionType})`,
      );
    }),

  listByProject: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("ios_bundle_configurations")
          .select(COLUMNS)
          .where("project_id", "=", params.projectId)
          .orderBy("bundle_identifier", "asc")
          .orderBy("distribution_type", "asc")
          .execute(),
      );
      return rows.map(toModel);
    }),

  findByProjectAndBundle: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("ios_bundle_configurations")
          .select(COLUMNS)
          .where("project_id", "=", params.projectId)
          .where("bundle_identifier", "=", params.bundleIdentifier)
          .where("distribution_type", "=", params.distributionType)
          .executeTakeFirst(),
      );
      if (row === undefined) {
        return yield* new NotFound({
          message: `No iOS bundle configuration found for ${params.bundleIdentifier} (${params.distributionType})`,
        });
      }
      return toModel(row);
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("ios_bundle_configurations")
          .select(COLUMNS)
          .where("id", "=", params.id)
          .executeTakeFirst(),
      );
      if (row === undefined) {
        return yield* new NotFound({ message: "iOS bundle configuration not found" });
      }
      return toModel(row);
    }),

  update: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const patch = compact({
        apple_distribution_certificate_id: params.appleDistributionCertificateId,
        apple_provisioning_profile_id: params.appleProvisioningProfileId,
        apple_push_key_id: params.applePushKeyId,
        asc_api_key_id: params.ascApiKeyId,
        target_name: params.targetName,
        parent_bundle_identifier: params.parentBundleIdentifier,
        updated_at: params.updatedAt,
      });
      yield* Effect.promise(async () =>
        db
          .updateTable("ios_bundle_configurations")
          .set(patch)
          .where("id", "=", params.id)
          .execute(),
      );
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db.deleteFrom("ios_bundle_configurations").where("id", "=", params.id).execute(),
      );
    }),
});
