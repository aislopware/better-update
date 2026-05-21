import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";
import { toDbNull } from "../lib/nullable";
import { d1RunWithUniqueCheck } from "./d1-helpers";

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

interface Row {
  id: string;
  organization_id: string;
  apple_team_id: string;
  serial_number: string;
  developer_id_identifier: string | null;
  valid_from: string;
  valid_until: string;
  r2_key: string;
  wrapped_dek: string;
  vault_version: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `"id", "organization_id", "apple_team_id", "serial_number", "developer_id_identifier", "valid_from", "valid_until", "r2_key", "wrapped_dek", "vault_version", "created_at", "updated_at"`;

const toModel = (row: Row): AppleDistributionCertificateModel => ({
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
        const env = yield* cloudflareEnv;
        yield* d1RunWithUniqueCheck(
          async () =>
            env.DB.prepare(
              `INSERT INTO "apple_distribution_certificates" (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
              .bind(
                params.id,
                params.organizationId,
                params.appleTeamId,
                params.serialNumber,
                params.developerIdIdentifier,
                params.validFrom,
                params.validUntil,
                params.r2Key,
                params.wrappedDek,
                params.vaultVersion,
                params.createdAt,
                params.updatedAt,
              )
              .run(),
          `Distribution certificate with serial ${params.serialNumber} already exists`,
        );
      }),

    listByOrg: (params) =>
      Effect.gen(function* () {
        const env = yield* cloudflareEnv;
        const rows = yield* Effect.promise(async () =>
          env.DB.prepare(
            `SELECT ${COLUMNS} FROM "apple_distribution_certificates" WHERE "organization_id" = ? ORDER BY "created_at" DESC`,
          )
            .bind(params.organizationId)
            .all<Row>(),
        );
        return rows.results.map(toModel);
      }),

    findById: (params) =>
      Effect.gen(function* () {
        const env = yield* cloudflareEnv;
        const row = yield* Effect.promise(async () =>
          env.DB.prepare(`SELECT ${COLUMNS} FROM "apple_distribution_certificates" WHERE "id" = ?`)
            .bind(params.id)
            .first<Row>(),
        );
        if (row === null) {
          return yield* Effect.fail(
            new NotFound({ message: "Distribution certificate not found" }),
          );
        }
        return toModel(row);
      }),

    delete: (params) =>
      Effect.gen(function* () {
        const env = yield* cloudflareEnv;
        const keyRow = yield* Effect.promise(async () =>
          env.DB.prepare(`SELECT "r2_key" FROM "apple_distribution_certificates" WHERE "id" = ?`)
            .bind(params.id)
            .first<{ r2_key: string }>(),
        );
        yield* Effect.promise(async () =>
          env.DB.prepare(`DELETE FROM "apple_distribution_certificates" WHERE "id" = ?`)
            .bind(params.id)
            .run(),
        );
        return { r2Key: toDbNull(keyRow?.r2_key) };
      }),
  },
);
