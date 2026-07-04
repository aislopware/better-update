import { toDbNull } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import type { Expression, Selectable, SqlBool } from "kysely";

import { kyselyDb } from "../cloudflare/db";
import { NotFound } from "../errors";

import type { AppleProvisioningProfiles } from "../db/schema";
import type { AppleProvisioningProfileModel, DistributionType } from "../models";

// -- Port -------------------------------------------------------------------

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
    /**
     * Snapshot of the team's protected flag at creation (spec §3b) — applied
     * on INSERT only; a re-upload keeps the existing row's own flag.
     */
    readonly isProtected: boolean;
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

  /** Toggle the per-row protected flag (GITLAB-RBAC-SPEC §3b). Idempotent. */
  readonly setProtection: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly isProtected: boolean;
    readonly now: string;
  }) => Effect.Effect<void>;

  readonly delete: (params: {
    readonly id: string;
  }) => Effect.Effect<{ readonly r2Key: string | null }>;
}

export class AppleProvisioningProfileRepo extends Context.Tag("api/AppleProvisioningProfileRepo")<
  AppleProvisioningProfileRepo,
  AppleProvisioningProfileRepository
>() {}

// -- D1 Adapter -------------------------------------------------------------

const toModel = (row: Selectable<AppleProvisioningProfiles>): AppleProvisioningProfileModel => ({
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
  isProtected: row.is_protected === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const AppleProvisioningProfileRepoLive = Layer.succeed(AppleProvisioningProfileRepo, {
  upsert: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const id = params.id ?? crypto.randomUUID();
      const now = new Date().toISOString();

      const existing = yield* Effect.promise(async () =>
        db
          .selectFrom("apple_provisioning_profiles")
          .select("r2_key")
          .where("organization_id", "=", params.organizationId)
          .where("apple_team_id", "=", params.appleTeamId)
          .where("bundle_identifier", "=", params.bundleIdentifier)
          .where("distribution_type", "=", params.distributionType)
          .executeTakeFirst(),
      );
      const previousR2Key =
        existing !== undefined && existing.r2_key !== params.r2Key ? existing.r2_key : null;

      const row = yield* Effect.promise(async () =>
        db
          .insertInto("apple_provisioning_profiles")
          .values({
            id,
            organization_id: params.organizationId,
            apple_team_id: params.appleTeamId,
            apple_distribution_certificate_id: params.appleDistributionCertificateId,
            bundle_identifier: params.bundleIdentifier,
            distribution_type: params.distributionType,
            developer_portal_identifier: params.developerPortalIdentifier,
            profile_name: params.profileName,
            valid_until: params.validUntil,
            r2_key: params.r2Key,
            is_managed: params.isManaged ? 1 : 0,
            device_roster_hash: params.deviceRosterHash,
            is_protected: params.isProtected ? 1 : 0,
            created_at: now,
            updated_at: now,
          })
          .onConflict((oc) =>
            oc
              .columns([
                "organization_id",
                "apple_team_id",
                "bundle_identifier",
                "distribution_type",
              ])
              .doUpdateSet((eb) => ({
                apple_distribution_certificate_id: eb.ref(
                  "excluded.apple_distribution_certificate_id",
                ),
                developer_portal_identifier: eb.ref("excluded.developer_portal_identifier"),
                profile_name: eb.ref("excluded.profile_name"),
                valid_until: eb.ref("excluded.valid_until"),
                r2_key: eb.ref("excluded.r2_key"),
                is_managed: eb.ref("excluded.is_managed"),
                device_roster_hash: eb.ref("excluded.device_roster_hash"),
                updated_at: eb.ref("excluded.updated_at"),
              })),
          )
          .returningAll()
          .executeTakeFirst(),
      );

      if (row === undefined) {
        return yield* Effect.die(new Error("Profile upsert failed"));
      }
      return { model: toModel(row), previousR2Key };
    }),

  list: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("apple_provisioning_profiles")
          .selectAll()
          .where((eb) => {
            const conditions: (Expression<SqlBool> | null)[] = [
              eb("organization_id", "=", params.organizationId),
              params.bundleIdentifier === undefined
                ? null
                : eb("bundle_identifier", "=", params.bundleIdentifier),
              params.distributionType === undefined
                ? null
                : eb("distribution_type", "=", params.distributionType),
              params.appleTeamId === undefined
                ? null
                : eb("apple_team_id", "=", params.appleTeamId),
            ];
            return eb.and(conditions.filter((cond): cond is Expression<SqlBool> => cond !== null));
          })
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
          .selectFrom("apple_provisioning_profiles")
          .selectAll()
          .where("id", "=", params.id)
          .executeTakeFirst(),
      );
      if (row === undefined) {
        return yield* new NotFound({ message: "Provisioning profile not found" });
      }
      return toModel(row);
    }),

  setProtection: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .updateTable("apple_provisioning_profiles")
          .set({ is_protected: params.isProtected ? 1 : 0, updated_at: params.now })
          .where("id", "=", params.id)
          .where("organization_id", "=", params.organizationId)
          .execute(),
      );
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .deleteFrom("apple_provisioning_profiles")
          .where("id", "=", params.id)
          .returning("r2_key")
          .executeTakeFirst(),
      );
      return { r2Key: toDbNull(row?.r2_key) };
    }),
});
