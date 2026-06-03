import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";
import { toDbNull } from "../lib/nullable";

import type { AppleProvisioningProfileModel, DistributionType } from "../models";

export interface AppleProvisioningProfileRepository {
  readonly upsert: (params: {
    readonly id?: string;
    readonly organizationId: string;
    readonly appleTeamId: string;
    readonly appleDistributionCertificateId: string | null;
    readonly bundleIdentifier: string;
    readonly distributionType: DistributionType;
    readonly developerPortalIdentifier: string | null;
    readonly profileName: string | null;
    readonly validUntil: string | null;
    readonly r2Key: string;
    readonly isManaged: boolean;
    readonly deviceRosterHash: string | null;
  }) => Effect.Effect<{
    readonly model: AppleProvisioningProfileModel;
    readonly previousR2Key: string | null;
  }>;

  readonly list: (params: {
    readonly organizationId: string;
    readonly bundleIdentifier?: string | undefined;
    readonly distributionType?: DistributionType | undefined;
    readonly appleTeamId?: string | undefined;
  }) => Effect.Effect<readonly AppleProvisioningProfileModel[]>;

  readonly findById: (params: {
    readonly id: string;
  }) => Effect.Effect<AppleProvisioningProfileModel, NotFound>;

  readonly delete: (params: {
    readonly id: string;
  }) => Effect.Effect<{ readonly r2Key: string | null }>;
}

export class AppleProvisioningProfileRepo extends Context.Tag("api/AppleProvisioningProfileRepo")<
  AppleProvisioningProfileRepo,
  AppleProvisioningProfileRepository
>() {}

interface Row {
  id: string;
  organization_id: string;
  apple_team_id: string;
  apple_distribution_certificate_id: string | null;
  bundle_identifier: string;
  distribution_type: DistributionType;
  developer_portal_identifier: string | null;
  profile_name: string | null;
  valid_until: string | null;
  r2_key: string;
  is_managed: number;
  device_roster_hash: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `"id", "organization_id", "apple_team_id", "apple_distribution_certificate_id", "bundle_identifier", "distribution_type", "developer_portal_identifier", "profile_name", "valid_until", "r2_key", "is_managed", "device_roster_hash", "created_at", "updated_at"`;

const toModel = (row: Row): AppleProvisioningProfileModel => ({
  id: row.id,
  organizationId: row.organization_id,
  appleTeamId: row.apple_team_id,
  appleDistributionCertificateId: row.apple_distribution_certificate_id,
  bundleIdentifier: row.bundle_identifier,
  distributionType: row.distribution_type,
  developerPortalIdentifier: row.developer_portal_identifier,
  profileName: row.profile_name,
  validUntil: row.valid_until,
  r2Key: row.r2_key,
  isManaged: row.is_managed === 1,
  deviceRosterHash: row.device_roster_hash,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const AppleProvisioningProfileRepoLive = Layer.succeed(AppleProvisioningProfileRepo, {
  upsert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const id = params.id ?? crypto.randomUUID();
      const now = new Date().toISOString();

      const existing = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "r2_key" FROM "apple_provisioning_profiles" WHERE "organization_id" = ? AND "apple_team_id" = ? AND "bundle_identifier" = ? AND "distribution_type" = ?`,
        )
          .bind(
            params.organizationId,
            params.appleTeamId,
            params.bundleIdentifier,
            params.distributionType,
          )
          .first<{ r2_key: string }>(),
      );
      const previousR2Key =
        existing !== null && existing.r2_key !== params.r2Key ? existing.r2_key : null;

      yield* Effect.promise(async () =>
        env.DB.prepare(
          `INSERT INTO "apple_provisioning_profiles" (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT ("organization_id", "apple_team_id", "bundle_identifier", "distribution_type") DO UPDATE SET
             "apple_distribution_certificate_id" = excluded."apple_distribution_certificate_id",
             "developer_portal_identifier" = excluded."developer_portal_identifier",
             "profile_name" = excluded."profile_name",
             "valid_until" = excluded."valid_until",
             "r2_key" = excluded."r2_key",
             "is_managed" = excluded."is_managed",
             "device_roster_hash" = excluded."device_roster_hash",
             "updated_at" = excluded."updated_at"`,
        )
          .bind(
            id,
            params.organizationId,
            params.appleTeamId,
            params.appleDistributionCertificateId,
            params.bundleIdentifier,
            params.distributionType,
            params.developerPortalIdentifier,
            params.profileName,
            params.validUntil,
            params.r2Key,
            params.isManaged ? 1 : 0,
            params.deviceRosterHash,
            now,
            now,
          )
          .run(),
      );

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "apple_provisioning_profiles" WHERE "organization_id" = ? AND "apple_team_id" = ? AND "bundle_identifier" = ? AND "distribution_type" = ?`,
        )
          .bind(
            params.organizationId,
            params.appleTeamId,
            params.bundleIdentifier,
            params.distributionType,
          )
          .first<Row>(),
      );
      if (row === null) {
        return yield* Effect.die(new Error("Profile upsert failed"));
      }
      return { model: toModel(row), previousR2Key };
    }),

  list: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const filters: string[] = [`"organization_id" = ?`];
      const bindings: (string | number)[] = [params.organizationId];
      if (params.bundleIdentifier !== undefined) {
        filters.push(`"bundle_identifier" = ?`);
        bindings.push(params.bundleIdentifier);
      }
      if (params.distributionType !== undefined) {
        filters.push(`"distribution_type" = ?`);
        bindings.push(params.distributionType);
      }
      if (params.appleTeamId !== undefined) {
        filters.push(`"apple_team_id" = ?`);
        bindings.push(params.appleTeamId);
      }
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "apple_provisioning_profiles" WHERE ${filters.join(" AND ")} ORDER BY "created_at" DESC`,
        )
          .bind(...bindings)
          .all<Row>(),
      );
      return rows.results.map(toModel);
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${COLUMNS} FROM "apple_provisioning_profiles" WHERE "id" = ?`)
          .bind(params.id)
          .first<Row>(),
      );
      if (row === null) {
        return yield* new NotFound({ message: "Provisioning profile not found" });
      }
      return toModel(row);
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const keyRow = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT "r2_key" FROM "apple_provisioning_profiles" WHERE "id" = ?`)
          .bind(params.id)
          .first<{ r2_key: string }>(),
      );
      yield* Effect.promise(async () =>
        env.DB.prepare(`DELETE FROM "apple_provisioning_profiles" WHERE "id" = ?`)
          .bind(params.id)
          .run(),
      );
      return { r2Key: toDbNull(keyRow?.r2_key) };
    }),
});
