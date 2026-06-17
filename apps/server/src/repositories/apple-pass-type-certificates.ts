import { toDbNull } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import type { Selectable } from "kysely";

import { kyselyDb } from "../cloudflare/db";
import { NotFound } from "../errors";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { ApplePassTypeCertificates } from "../db/schema";
import type { Conflict } from "../errors";
import type { ApplePassTypeCertificateModel } from "../models";

// -- Port -------------------------------------------------------------------

export interface ApplePassTypeCertificateRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly appleTeamId: string;
    readonly passTypeIdentifier: string;
    readonly serialNumber: string;
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
  }) => Effect.Effect<readonly ApplePassTypeCertificateModel[]>;

  readonly findById: (params: {
    readonly id: string;
  }) => Effect.Effect<ApplePassTypeCertificateModel, NotFound>;

  readonly delete: (params: {
    readonly id: string;
  }) => Effect.Effect<{ readonly r2Key: string | null }>;
}

export class ApplePassTypeCertificateRepo extends Context.Tag("api/ApplePassTypeCertificateRepo")<
  ApplePassTypeCertificateRepo,
  ApplePassTypeCertificateRepository
>() {}

// -- D1 Adapter -------------------------------------------------------------

const COLUMNS = [
  "id",
  "organization_id",
  "apple_team_id",
  "pass_type_identifier",
  "serial_number",
  "valid_from",
  "valid_until",
  "r2_key",
  "wrapped_dek",
  "vault_version",
  "created_at",
  "updated_at",
] as const;

const toModel = (row: Selectable<ApplePassTypeCertificates>): ApplePassTypeCertificateModel => ({
  id: row.id,
  organizationId: row.organization_id,
  appleTeamId: row.apple_team_id,
  passTypeIdentifier: row.pass_type_identifier,
  serialNumber: row.serial_number,
  validFrom: row.valid_from,
  validUntil: row.valid_until,
  r2Key: row.r2_key,
  wrappedDek: row.wrapped_dek,
  vaultVersion: row.vault_version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const ApplePassTypeCertificateRepoLive = Layer.succeed(ApplePassTypeCertificateRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* d1RunWithUniqueCheck(
        async () =>
          db
            .insertInto("apple_pass_type_certificates")
            .values({
              id: params.id,
              organization_id: params.organizationId,
              apple_team_id: params.appleTeamId,
              pass_type_identifier: params.passTypeIdentifier,
              serial_number: params.serialNumber,
              valid_from: params.validFrom,
              valid_until: params.validUntil,
              r2_key: params.r2Key,
              wrapped_dek: params.wrappedDek,
              vault_version: params.vaultVersion,
              created_at: params.createdAt,
              updated_at: params.updatedAt,
            })
            .execute(),
        `Pass Type ID certificate ${params.serialNumber} already uploaded`,
      );
    }),

  listByOrg: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("apple_pass_type_certificates")
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
          .selectFrom("apple_pass_type_certificates")
          .select(COLUMNS)
          .where("id", "=", params.id)
          .executeTakeFirst(),
      );
      if (row === undefined) {
        return yield* new NotFound({ message: "Pass Type ID certificate not found" });
      }
      return toModel(row);
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .deleteFrom("apple_pass_type_certificates")
          .where("id", "=", params.id)
          .returning(["r2_key"])
          .executeTakeFirst(),
      );
      return { r2Key: toDbNull(row?.r2_key) };
    }),
});
