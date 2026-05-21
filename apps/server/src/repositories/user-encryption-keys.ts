import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { Conflict } from "../errors";
import type { EncryptionKeyKind, UserEncryptionKeyModel } from "../models";

export interface UserEncryptionKeyRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly userId: string | null;
    readonly organizationId: string | null;
    readonly kind: EncryptionKeyKind;
    readonly publicKey: string;
    readonly label: string;
    readonly fingerprint: string;
    readonly createdAt: string;
  }) => Effect.Effect<void, Conflict>;

  readonly findById: (params: {
    readonly id: string;
  }) => Effect.Effect<UserEncryptionKeyModel, NotFound>;

  /** Keys visible to the actor in this org: org-owned (machine/recovery) plus the caller's own devices. */
  readonly listForActor: (params: {
    readonly organizationId: string;
    readonly userId: string | null;
  }) => Effect.Effect<readonly UserEncryptionKeyModel[]>;

  /**
   * Recipients an admin can grant the vault to: org-owned keys plus the device
   * key of every current org member, so a freshly-registered member device is
   * discoverable for `credentials access grant`.
   */
  readonly listGrantable: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly UserEncryptionKeyModel[]>;
}

export class UserEncryptionKeyRepo extends Context.Tag("api/UserEncryptionKeyRepo")<
  UserEncryptionKeyRepo,
  UserEncryptionKeyRepository
>() {}

interface Row {
  id: string;
  user_id: string | null;
  organization_id: string | null;
  kind: EncryptionKeyKind;
  public_key: string;
  label: string;
  fingerprint: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const COLUMNS = `"id", "user_id", "organization_id", "kind", "public_key", "label", "fingerprint", "created_at", "last_used_at", "revoked_at"`;

const toModel = (row: Row): UserEncryptionKeyModel => ({
  id: row.id,
  userId: row.user_id,
  organizationId: row.organization_id,
  kind: row.kind,
  publicKey: row.public_key,
  label: row.label,
  fingerprint: row.fingerprint,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
  revokedAt: row.revoked_at,
});

export const UserEncryptionKeyRepoLive = Layer.succeed(UserEncryptionKeyRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* d1RunWithUniqueCheck(
        async () =>
          env.DB.prepare(
            `INSERT INTO "user_encryption_keys" (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
            .bind(
              params.id,
              params.userId,
              params.organizationId,
              params.kind,
              params.publicKey,
              params.label,
              params.fingerprint,
              params.createdAt,
              null,
              null,
            )
            .run(),
        "Encryption key already registered",
      );
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${COLUMNS} FROM "user_encryption_keys" WHERE "id" = ?`)
          .bind(params.id)
          .first<Row>(),
      );
      if (row === null) {
        return yield* Effect.fail(new NotFound({ message: "Encryption key not found" }));
      }
      return toModel(row);
    }),

  listForActor: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "user_encryption_keys" WHERE "organization_id" = ? OR "user_id" = ? ORDER BY "created_at" DESC`,
        )
          .bind(params.organizationId, params.userId)
          .all<Row>(),
      );
      return rows.results.map(toModel);
    }),

  listGrantable: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      // Org-owned keys (machine/recovery) plus every device key whose owner is a
      // current member of the org. Device keys carry no organization_id, so they
      // are reached via the member roster rather than a direct column match.
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "user_encryption_keys" WHERE "organization_id" = ?1 OR "user_id" IN (SELECT "user_id" FROM "member" WHERE "organization_id" = ?1) ORDER BY "created_at" DESC`,
        )
          .bind(params.organizationId)
          .all<Row>(),
      );
      return rows.results.map(toModel);
    }),
});
