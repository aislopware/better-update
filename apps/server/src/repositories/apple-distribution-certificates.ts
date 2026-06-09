import { toDbNull } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import type { Selectable } from "kysely";

import { kyselyDb } from "../cloudflare/db";
import { NotFound } from "../errors";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { AppleDistributionCertificates } from "../db/schema";
import type { Conflict } from "../errors";
import type { AppleDistributionCertificateModel } from "../models";

export interface AppleDistributionCertificateRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly appleTeamId: string;
    readonly serialNumber: string;
    readonly developerIdIdentifier: string | null;
    readonly validFrom: string;
    readonly validUntil: string;
    readonly r2Key: string;
    readonly wrappedDek: string;
    readonly vaultVersion: number;
    readonly createdAt: string;
    readonly updatedAt: string;
  }) => Effect.Effect<void, Conflict>;

  readonly listByOrg: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly AppleDistributionCertificateModel[]>;

  readonly findById: (params: {
    readonly id: string;
  }) => Effect.Effect<AppleDistributionCertificateModel, NotFound>;

  readonly delete: (params: {
    readonly id: string;
  }) => Effect.Effect<{ readonly r2Key: string | null }>;
}

export class AppleDistributionCertificateRepo extends Context.Tag(
  "api/AppleDistributionCertificateRepo",
)<AppleDistributionCertificateRepo, AppleDistributionCertificateRepository>() {}

// -- D1 Adapter -------------------------------------------------------------

const COLUMNS = [
  "id",
  "organization_id",
  "apple_team_id",
  "serial_number",
  "developer_id_identifier",
  "valid_from",
  "valid_until",
  "r2_key",
  "wrapped_dek",
  "vault_version",
  "created_at",
  "updated_at",
] as const;

const toModel = (
  row: Selectable<AppleDistributionCertificates>,
): AppleDistributionCertificateModel => ({
  id: row.id,
  organizationId: row.organization_id,
  appleTeamId: row.apple_team_id,
  serialNumber: row.serial_number,
  developerIdIdentifier: row.developer_id_identifier,
  validFrom: row.valid_from,
  validUntil: row.valid_until,
  r2Key: row.r2_key,
  wrappedDek: row.wrapped_dek,
  vaultVersion: row.vault_version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const AppleDistributionCertificateRepoLive = Layer.succeed(
  AppleDistributionCertificateRepo,
  {
    insert: (params) =>
      Effect.gen(function* () {
        const db = yield* kyselyDb;
        yield* d1RunWithUniqueCheck(
          async () =>
            db
              .insertInto("apple_distribution_certificates")
              .values({
                id: params.id,
                organization_id: params.organizationId,
                apple_team_id: params.appleTeamId,
                serial_number: params.serialNumber,
                developer_id_identifier: params.developerIdIdentifier,
                valid_from: params.validFrom,
                valid_until: params.validUntil,
                r2_key: params.r2Key,
                wrapped_dek: params.wrappedDek,
                vault_version: params.vaultVersion,
                created_at: params.createdAt,
                updated_at: params.updatedAt,
              })
              .execute(),
          `Distribution certificate with serial ${params.serialNumber} already exists`,
        );
      }),

    listByOrg: (params) =>
      Effect.gen(function* () {
        const db = yield* kyselyDb;
        const rows = yield* Effect.promise(async () =>
          db
            .selectFrom("apple_distribution_certificates")
            .select(COLUMNS)
            .where("organization_id", "=", params.organizationId)
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
            .selectFrom("apple_distribution_certificates")
            .select(COLUMNS)
            .where("id", "=", params.id)
            .executeTakeFirst(),
        );
        if (row === undefined) {
          return yield* new NotFound({ message: "Distribution certificate not found" });
        }
        return toModel(row);
      }),

    delete: (params) =>
      Effect.gen(function* () {
        const db = yield* kyselyDb;
        const keyRow = yield* Effect.promise(async () =>
          db
            .selectFrom("apple_distribution_certificates")
            .select(["r2_key"])
            .where("id", "=", params.id)
            .executeTakeFirst(),
        );
        yield* Effect.promise(async () =>
          db.deleteFrom("apple_distribution_certificates").where("id", "=", params.id).execute(),
        );
        return { r2Key: toDbNull(keyRow?.r2_key) };
      }),
  },
);
