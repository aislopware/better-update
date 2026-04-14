import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";

import type { CredentialDistribution, CredentialModel, CredentialType, Platform } from "../models";

// -- Port ------------------------------------------------------------------

export interface CredentialRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly projectId: string | null;
    readonly platform: Platform;
    readonly type: CredentialType;
    readonly name: string;
    readonly distribution: CredentialDistribution | null;
    readonly r2Key: string;
    readonly encryptedDek: string;
    readonly keyVersion: number;
    readonly encryptedPassword: string | null;
    readonly encryptedKeyAlias: string | null;
    readonly encryptedKeyPassword: string | null;
    readonly metadataJson: string;
    readonly expiresAt: string | null;
  }) => Effect.Effect<CredentialModel>;

  readonly findById: (params: { readonly id: string }) => Effect.Effect<CredentialModel, NotFound>;

  readonly list: (params: {
    readonly organizationId: string;
    readonly projectId?: string;
    readonly platform?: Platform;
    readonly type?: string;
    readonly distribution?: string;
    readonly limit: number;
    readonly offset: number;
  }) => Effect.Effect<{ readonly items: readonly CredentialModel[]; readonly total: number }>;

  readonly deleteById: (params: {
    readonly id: string;
  }) => Effect.Effect<{ readonly r2Key: string | null }, NotFound>;

  readonly activate: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly projectId: string | null;
    readonly platform: string;
    readonly type: string;
    readonly distribution: string | null;
  }) => Effect.Effect<CredentialModel, NotFound>;

  readonly findEncryptionData: (params: { readonly id: string }) => Effect.Effect<
    {
      readonly r2Key: string;
      readonly encryptedDek: string;
      readonly keyVersion: number;
      readonly encryptedPassword: string | null;
      readonly encryptedKeyAlias: string | null;
      readonly encryptedKeyPassword: string | null;
      readonly name: string;
      readonly type: string;
      readonly organizationId: string;
    },
    NotFound
  >;
}

export class CredentialRepo extends Context.Tag("api/CredentialRepo")<
  CredentialRepo,
  CredentialRepository
>() {}

// -- D1 Adapter ------------------------------------------------------------

interface CredentialRow {
  id: string;
  organization_id: string;
  project_id: string | null;
  platform: Platform;
  type: CredentialType;
  name: string;
  distribution: CredentialDistribution | null;
  is_active: number;
  metadata_json: string;
  expires_at: string | null;
  created_at: string;
}

interface EncryptionDataRow {
  r2_key: string;
  encrypted_dek: string;
  key_version: number;
  encrypted_password: string | null;
  encrypted_key_alias: string | null;
  encrypted_key_password: string | null;
  name: string;
  type: string;
  organization_id: string;
}

const toCredential = (row: CredentialRow) =>
  ({
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    platform: row.platform,
    type: row.type,
    name: row.name,
    distribution: row.distribution,
    isActive: row.is_active === 1,
    metadata: row.metadata_json,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }) satisfies CredentialModel;

const SELECT_COLUMNS = `"id", "organization_id", "project_id", "platform", "type", "name", "distribution", "is_active", "metadata_json", "expires_at", "created_at"`;

export const CredentialRepoLive = Layer.succeed(CredentialRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const now = new Date().toISOString();

      yield* Effect.promise(async () =>
        env.DB.prepare(
          `INSERT INTO "credentials" ("id", "organization_id", "project_id", "platform", "type", "name", "distribution", "is_active", "r2_key", "encrypted_dek", "key_version", "encrypted_password", "encrypted_key_alias", "encrypted_key_password", "metadata_json", "expires_at", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            params.id,
            params.organizationId,
            params.projectId,
            params.platform,
            params.type,
            params.name,
            params.distribution,
            params.r2Key,
            params.encryptedDek,
            params.keyVersion,
            params.encryptedPassword,
            params.encryptedKeyAlias,
            params.encryptedKeyPassword,
            params.metadataJson,
            params.expiresAt,
            now,
          )
          .run(),
      );

      return {
        id: params.id,
        organizationId: params.organizationId,
        projectId: params.projectId,
        platform: params.platform,
        type: params.type,
        name: params.name,
        distribution: params.distribution,
        isActive: false,
        metadata: params.metadataJson,
        expiresAt: params.expiresAt,
        createdAt: now,
      } satisfies CredentialModel;
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${SELECT_COLUMNS} FROM "credentials" WHERE "id" = ?`)
          .bind(params.id)
          .first<CredentialRow>(),
      );

      if (row === null) {
        return yield* Effect.fail(new NotFound({ message: "Credential not found" }));
      }

      return toCredential(row);
    }),

  list: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const conditions: string[] = ['"organization_id" = ?'];
      const bindValues: (string | number)[] = [params.organizationId];

      if (params.projectId) {
        conditions.push('("project_id" = ? OR "project_id" IS NULL)');
        bindValues.push(params.projectId);
      }
      if (params.platform) {
        conditions.push('"platform" = ?');
        bindValues.push(params.platform);
      }
      if (params.type) {
        conditions.push('"type" = ?');
        bindValues.push(params.type);
      }
      if (params.distribution) {
        conditions.push('"distribution" = ?');
        bindValues.push(params.distribution);
      }

      const whereClause = conditions.join(" AND ");

      const [countResult, rows] = yield* Effect.all(
        [
          Effect.promise(async () =>
            env.DB.prepare(`SELECT COUNT(*) as count FROM "credentials" WHERE ${whereClause}`)
              .bind(...bindValues)
              .first<{ count: number }>(),
          ),
          Effect.promise(async () =>
            env.DB.prepare(
              `SELECT ${SELECT_COLUMNS} FROM "credentials" WHERE ${whereClause} ORDER BY "created_at" DESC LIMIT ? OFFSET ?`,
            )
              .bind(...bindValues, params.limit, params.offset)
              .all<CredentialRow>(),
          ),
        ],
        { concurrency: "unbounded" },
      );

      return { items: rows.results.map(toCredential), total: countResult?.count ?? 0 };
    }),

  deleteById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const r2Row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT "r2_key" FROM "credentials" WHERE "id" = ?`)
          .bind(params.id)
          .first<{ r2_key: string }>(),
      );

      const result = yield* Effect.promise(async () =>
        env.DB.prepare(`DELETE FROM "credentials" WHERE "id" = ?`).bind(params.id).run(),
      );

      if (result.meta.changes === 0) {
        return yield* Effect.fail(new NotFound({ message: "Credential not found" }));
      }

      return { r2Key: r2Row?.r2_key ?? null };
    }),

  activate: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const checkRow = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT 1 FROM "credentials" WHERE "id" = ?`).bind(params.id).first(),
      );
      if (checkRow === null) {
        return yield* Effect.fail(new NotFound({ message: "Credential not found" }));
      }

      yield* Effect.promise(async () =>
        env.DB.batch([
          env.DB.prepare(
            `UPDATE "credentials" SET "is_active" = 0 WHERE "organization_id" = ? AND COALESCE("project_id", '') = ? AND "platform" = ? AND "type" = ? AND COALESCE("distribution", '') = ? AND "is_active" = 1`,
          ).bind(
            params.organizationId,
            params.projectId ?? "",
            params.platform,
            params.type,
            params.distribution ?? "",
          ),
          env.DB.prepare(`UPDATE "credentials" SET "is_active" = 1 WHERE "id" = ?`).bind(params.id),
        ]),
      );

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${SELECT_COLUMNS} FROM "credentials" WHERE "id" = ?`)
          .bind(params.id)
          .first<CredentialRow>(),
      );

      if (row === null) {
        return yield* Effect.fail(new NotFound({ message: "Credential not found" }));
      }

      return toCredential(row);
    }),

  findEncryptionData: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "r2_key", "encrypted_dek", "key_version", "encrypted_password", "encrypted_key_alias", "encrypted_key_password", "name", "type", "organization_id" FROM "credentials" WHERE "id" = ?`,
        )
          .bind(params.id)
          .first<EncryptionDataRow>(),
      );

      if (row === null) {
        return yield* Effect.fail(new NotFound({ message: "Credential not found" }));
      }

      return {
        r2Key: row.r2_key,
        encryptedDek: row.encrypted_dek,
        keyVersion: row.key_version,
        encryptedPassword: row.encrypted_password,
        encryptedKeyAlias: row.encrypted_key_alias,
        encryptedKeyPassword: row.encrypted_key_password,
        name: row.name,
        type: row.type,
        organizationId: row.organization_id,
      };
    }),
});
