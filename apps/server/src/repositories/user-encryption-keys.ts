import { Context, Effect, Layer } from "effect";

import type { Selectable } from "kysely";

import { kyselyDb } from "../cloudflare/db";
import { NotFound } from "../errors";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { UserEncryptionKeys } from "../db/schema";
import type { Conflict } from "../errors";
import type { EncryptionKeyKind } from "../models";
import type { UserEncryptionKeyModel } from "../vault-models";

// -- Port -------------------------------------------------------------------

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

// -- D1 Adapter -------------------------------------------------------------

const COLUMNS = [
  "id",
  "user_id",
  "organization_id",
  "kind",
  "public_key",
  "label",
  "fingerprint",
  "created_at",
  "last_used_at",
  "revoked_at",
] as const;

const toModel = (row: Selectable<UserEncryptionKeys>): UserEncryptionKeyModel => ({
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
      const db = yield* kyselyDb;
      yield* d1RunWithUniqueCheck(
        async () =>
          db
            .insertInto("user_encryption_keys")
            .values({
              id: params.id,
              user_id: params.userId,
              organization_id: params.organizationId,
              kind: params.kind,
              public_key: params.publicKey,
              label: params.label,
              fingerprint: params.fingerprint,
              created_at: params.createdAt,
              last_used_at: null,
              revoked_at: null,
            })
            .execute(),
        "Encryption key already registered",
      );
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("user_encryption_keys")
          .select(COLUMNS)
          .where("id", "=", params.id)
          .executeTakeFirst(),
      );
      if (row === undefined) {
        return yield* new NotFound({ message: "Encryption key not found" });
      }
      return toModel(row);
    }),

  listForActor: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("user_encryption_keys")
          .select(COLUMNS)
          .where((eb) => {
            const orgCondition = eb("organization_id", "=", params.organizationId);
            return params.userId === null
              ? orgCondition
              : eb.or([orgCondition, eb("user_id", "=", params.userId)]);
          })
          .orderBy("created_at", "desc")
          .execute(),
      );
      return rows.map(toModel);
    }),

  listGrantable: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      // Org-owned keys (machine/recovery) plus every device key whose owner is a
      // current member of the org. Device keys carry no organization_id, so they
      // are reached via the member roster rather than a direct column match.
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("user_encryption_keys")
          .select(COLUMNS)
          .where((eb) =>
            eb.or([
              eb("organization_id", "=", params.organizationId),
              eb(
                "user_id",
                "in",
                eb
                  .selectFrom("member")
                  .select("user_id")
                  .where("organization_id", "=", params.organizationId),
              ),
            ]),
          )
          .orderBy("created_at", "desc")
          .execute(),
      );
      return rows.map(toModel);
    }),
});
