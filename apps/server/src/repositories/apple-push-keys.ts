import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";
import { toDbNull } from "../lib/nullable";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { Conflict } from "../errors";
import type { ApplePushKeyModel } from "../models";

export interface ApplePushKeyRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly appleTeamId: string;
    readonly keyId: string;
    readonly r2Key: string;
    readonly wrappedDek: string;
    readonly vaultVersion: number;
    readonly createdAt: string;
    readonly updatedAt: string;
  }) => Effect.Effect<void, Conflict>;

  readonly listByOrg: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly ApplePushKeyModel[]>;

  readonly findById: (params: {
    readonly id: string;
  }) => Effect.Effect<ApplePushKeyModel, NotFound>;

  readonly delete: (params: {
    readonly id: string;
  }) => Effect.Effect<{ readonly r2Key: string | null }>;
}

export class ApplePushKeyRepo extends Context.Tag("api/ApplePushKeyRepo")<
  ApplePushKeyRepo,
  ApplePushKeyRepository
>() {}

interface Row {
  id: string;
  organization_id: string;
  apple_team_id: string;
  key_id: string;
  r2_key: string;
  wrapped_dek: string;
  vault_version: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `"id", "organization_id", "apple_team_id", "key_id", "r2_key", "wrapped_dek", "vault_version", "created_at", "updated_at"`;

const toModel = (row: Row): ApplePushKeyModel => ({
  id: row.id,
  organizationId: row.organization_id,
  appleTeamId: row.apple_team_id,
  keyId: row.key_id,
  r2Key: row.r2_key,
  wrappedDek: row.wrapped_dek,
  vaultVersion: row.vault_version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const ApplePushKeyRepoLive = Layer.succeed(ApplePushKeyRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* d1RunWithUniqueCheck(
        async () =>
          env.DB.prepare(
            `INSERT INTO "apple_push_keys" (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
            .bind(
              params.id,
              params.organizationId,
              params.appleTeamId,
              params.keyId,
              params.r2Key,
              params.wrappedDek,
              params.vaultVersion,
              params.createdAt,
              params.updatedAt,
            )
            .run(),
        `Push key ${params.keyId} already uploaded`,
      );
    }),

  listByOrg: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "apple_push_keys" WHERE "organization_id" = ? ORDER BY "created_at" DESC`,
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
        env.DB.prepare(`SELECT ${COLUMNS} FROM "apple_push_keys" WHERE "id" = ?`)
          .bind(params.id)
          .first<Row>(),
      );
      if (row === null) {
        return yield* new NotFound({ message: "Push key not found" });
      }
      return toModel(row);
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const keyRow = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT "r2_key" FROM "apple_push_keys" WHERE "id" = ?`)
          .bind(params.id)
          .first<{ r2_key: string }>(),
      );
      yield* Effect.promise(async () =>
        env.DB.prepare(`DELETE FROM "apple_push_keys" WHERE "id" = ?`).bind(params.id).run(),
      );
      return { r2Key: toDbNull(keyRow?.r2_key) };
    }),
});
