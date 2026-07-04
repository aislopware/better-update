import { toDbNull } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import type { Selectable } from "kysely";

import { kyselyDb } from "../cloudflare/db";
import { NotFound } from "../errors";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { ApplePushCertificates } from "../db/schema";
import type { Conflict } from "../errors";
import type { ApplePushCertificateModel } from "../models";

// -- Port -------------------------------------------------------------------

export interface ApplePushCertificateRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly appleTeamId: string;
    readonly bundleIdentifier: string;
    readonly serialNumber: string;
    readonly validFrom: string;
    readonly validUntil: string;
    readonly r2Key: string;
    readonly wrappedDek: string;
    readonly vaultVersion: number;
    /** Snapshot of the team's protected flag at creation (spec §3b). */
    readonly isProtected: boolean;
    readonly createdAt: string;
    readonly updatedAt: string;
  }) => Effect.Effect<void, Conflict>;

  readonly listByOrg: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly ApplePushCertificateModel[]>;

  readonly findById: (params: {
    readonly id: string;
  }) => Effect.Effect<ApplePushCertificateModel, NotFound>;

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

export class ApplePushCertificateRepo extends Context.Tag("api/ApplePushCertificateRepo")<
  ApplePushCertificateRepo,
  ApplePushCertificateRepository
>() {}

// -- D1 Adapter -------------------------------------------------------------

const COLUMNS = [
  "id",
  "organization_id",
  "apple_team_id",
  "bundle_identifier",
  "serial_number",
  "valid_from",
  "valid_until",
  "r2_key",
  "wrapped_dek",
  "vault_version",
  "is_protected",
  "created_at",
  "updated_at",
] as const;

const toModel = (row: Selectable<ApplePushCertificates>): ApplePushCertificateModel => ({
  id: row.id,
  organizationId: row.organization_id,
  appleTeamId: row.apple_team_id,
  bundleIdentifier: row.bundle_identifier,
  serialNumber: row.serial_number,
  validFrom: row.valid_from,
  validUntil: row.valid_until,
  r2Key: row.r2_key,
  wrappedDek: row.wrapped_dek,
  vaultVersion: row.vault_version,
  isProtected: row.is_protected === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const ApplePushCertificateRepoLive = Layer.succeed(ApplePushCertificateRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* d1RunWithUniqueCheck(
        async () =>
          db
            .insertInto("apple_push_certificates")
            .values({
              id: params.id,
              organization_id: params.organizationId,
              apple_team_id: params.appleTeamId,
              bundle_identifier: params.bundleIdentifier,
              serial_number: params.serialNumber,
              valid_from: params.validFrom,
              valid_until: params.validUntil,
              r2_key: params.r2Key,
              wrapped_dek: params.wrappedDek,
              vault_version: params.vaultVersion,
              is_protected: params.isProtected ? 1 : 0,
              created_at: params.createdAt,
              updated_at: params.updatedAt,
            })
            .execute(),
        `Push certificate ${params.serialNumber} already uploaded`,
      );
    }),

  listByOrg: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("apple_push_certificates")
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
          .selectFrom("apple_push_certificates")
          .select(COLUMNS)
          .where("id", "=", params.id)
          .executeTakeFirst(),
      );
      if (row === undefined) {
        return yield* new NotFound({ message: "Push certificate not found" });
      }
      return toModel(row);
    }),

  setProtection: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .updateTable("apple_push_certificates")
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
          .deleteFrom("apple_push_certificates")
          .where("id", "=", params.id)
          .returning(["r2_key"])
          .executeTakeFirst(),
      );
      return { r2Key: toDbNull(row?.r2_key) };
    }),
});
