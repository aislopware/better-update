import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";

import type { AppleTeamModel, AppleTeamType } from "../models";

export interface AppleTeamWithCounts extends AppleTeamModel {
  readonly distributionCertificateCount: number;
  readonly pushKeyCount: number;
  readonly ascApiKeyCount: number;
  readonly provisioningProfileCount: number;
  readonly deviceCount: number;
}

export interface AppleTeamRepository {
  readonly upsertByAppleTeamId: (params: {
    readonly organizationId: string;
    readonly appleTeamId: string;
    readonly appleTeamType: AppleTeamType;
    readonly name: string | null;
  }) => Effect.Effect<AppleTeamModel>;

  readonly findById: (params: { readonly id: string }) => Effect.Effect<AppleTeamModel, NotFound>;

  readonly findByAppleTeamId: (params: {
    readonly organizationId: string;
    readonly appleTeamId: string;
  }) => Effect.Effect<AppleTeamModel, NotFound>;

  readonly listWithCounts: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly AppleTeamWithCounts[]>;

  readonly delete: (params: { readonly id: string }) => Effect.Effect<void>;
}

export class AppleTeamRepo extends Context.Tag("api/AppleTeamRepo")<
  AppleTeamRepo,
  AppleTeamRepository
>() {}

interface Row {
  id: string;
  organization_id: string;
  apple_team_id: string;
  apple_team_type: AppleTeamType;
  name: string | null;
  created_at: string;
  updated_at: string;
}

interface RowWithCounts extends Row {
  distribution_certificate_count: number;
  push_key_count: number;
  asc_api_key_count: number;
  provisioning_profile_count: number;
  device_count: number;
}

const toModel = (row: Row): AppleTeamModel => ({
  id: row.id,
  organizationId: row.organization_id,
  appleTeamId: row.apple_team_id,
  appleTeamType: row.apple_team_type,
  name: row.name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toModelWithCounts = (row: RowWithCounts): AppleTeamWithCounts => ({
  ...toModel(row),
  distributionCertificateCount: row.distribution_certificate_count,
  pushKeyCount: row.push_key_count,
  ascApiKeyCount: row.asc_api_key_count,
  provisioningProfileCount: row.provisioning_profile_count,
  deviceCount: row.device_count,
});

const COLUMNS = `"id", "organization_id", "apple_team_id", "apple_team_type", "name", "created_at", "updated_at"`;

export const AppleTeamRepoLive = Layer.succeed(AppleTeamRepo, {
  upsertByAppleTeamId: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `INSERT INTO "apple_teams" ("id", "organization_id", "apple_team_id", "apple_team_type", "name", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT ("organization_id", "apple_team_id") DO UPDATE SET
             "apple_team_type" = excluded."apple_team_type",
             "name" = COALESCE(excluded."name", "apple_teams"."name"),
             "updated_at" = excluded."updated_at"
           RETURNING ${COLUMNS}`,
        )
          .bind(
            id,
            params.organizationId,
            params.appleTeamId,
            params.appleTeamType,
            params.name,
            now,
            now,
          )
          .first<Row>(),
      );
      if (row === null) {
        return yield* Effect.die(new Error("Apple team upsert failed"));
      }
      return toModel(row);
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${COLUMNS} FROM "apple_teams" WHERE "id" = ?`)
          .bind(params.id)
          .first<Row>(),
      );
      if (row === null) {
        return yield* new NotFound({ message: "Apple team not found" });
      }
      return toModel(row);
    }),

  findByAppleTeamId: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "apple_teams" WHERE "organization_id" = ? AND "apple_team_id" = ?`,
        )
          .bind(params.organizationId, params.appleTeamId)
          .first<Row>(),
      );
      if (row === null) {
        return yield* new NotFound({ message: "Apple team not found" });
      }
      return toModel(row);
    }),

  listWithCounts: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT t."id", t."organization_id", t."apple_team_id", t."apple_team_type", t."name", t."created_at", t."updated_at",
            (SELECT COUNT(*) FROM "apple_distribution_certificates" WHERE "apple_team_id" = t."id") AS "distribution_certificate_count",
            (SELECT COUNT(*) FROM "apple_push_keys" WHERE "apple_team_id" = t."id") AS "push_key_count",
            (SELECT COUNT(*) FROM "asc_api_keys" WHERE "apple_team_id" = t."id") AS "asc_api_key_count",
            (SELECT COUNT(*) FROM "apple_provisioning_profiles" WHERE "apple_team_id" = t."id") AS "provisioning_profile_count",
            (SELECT COUNT(*) FROM "devices" WHERE "apple_team_id" = t."id") AS "device_count"
          FROM "apple_teams" t
          WHERE t."organization_id" = ?
          ORDER BY t."created_at" DESC`,
        )
          .bind(params.organizationId)
          .all<RowWithCounts>(),
      );
      return rows.results.map(toModelWithCounts);
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.prepare(`DELETE FROM "apple_teams" WHERE "id" = ?`).bind(params.id).run(),
      );
    }),
});
