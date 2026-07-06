import { isRecord } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import type { Selectable } from "kysely";

import { kyselyDb } from "../cloudflare/db";
import { NotFound } from "../errors";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { AccountKeys } from "../db/schema";
import type { Conflict } from "../errors";
import type { AccountKeyKdfParams, AccountKeyModel } from "../vault-models";

// -- Port -------------------------------------------------------------------

export interface AccountKeyRepository {
  /** Register a new account key. Conflicts if the user already holds a live one. */
  readonly insert: (params: {
    readonly id: string;
    readonly userId: string;
    readonly agePublicKey: string;
    readonly ed25519PublicKey: string;
    readonly escrowCt: string;
    readonly salt: string;
    readonly kdfParams: AccountKeyKdfParams;
    readonly fingerprint: string;
    readonly createdAt: string;
  }) => Effect.Effect<void, Conflict>;

  /** The caller's live (not-revoked) account key, or `null` if not enrolled. */
  readonly findActiveByUser: (params: {
    readonly userId: string;
  }) => Effect.Effect<AccountKeyModel | null>;

  /** A single account key by id (for the env-vault grant/wrap path). */
  readonly findById: (params: { readonly id: string }) => Effect.Effect<AccountKeyModel, NotFound>;

  /** Live account keys for a set of users — the cutover wraps the env vault to each. */
  readonly listActiveByUsers: (params: {
    readonly userIds: readonly string[];
  }) => Effect.Effect<readonly AccountKeyModel[]>;

  /**
   * Re-seal the caller's live account key under a new passphrase: overwrite the
   * escrow ciphertext + salt + KDF params in place. The keypair is unchanged, so
   * every env-vault wrap to it stays valid.
   */
  readonly updateEscrow: (params: {
    readonly userId: string;
    readonly escrowCt: string;
    readonly salt: string;
    readonly kdfParams: AccountKeyKdfParams;
  }) => Effect.Effect<void>;

  /** Stamp the moment this account key downloaded its env wrap to unlock the vault (telemetry only). */
  readonly touchLastUsed: (params: {
    readonly id: string;
    readonly now: string;
  }) => Effect.Effect<void>;
}

export class AccountKeyRepo extends Context.Tag("api/AccountKeyRepo")<
  AccountKeyRepo,
  AccountKeyRepository
>() {}

// -- D1 Adapter -------------------------------------------------------------

const COLUMNS = [
  "id",
  "user_id",
  "age_public_key",
  "ed25519_public_key",
  "escrow_ct",
  "salt",
  "kdf_params",
  "fingerprint",
  "created_at",
  "last_used_at",
  "revoked_at",
] as const;

/** Parse the persisted `kdf_params` JSON, defaulting any missing field to 0 (treated as invalid downstream). */
const parseKdfParams = (raw: string): AccountKeyKdfParams => {
  const parsed: unknown = JSON.parse(raw);
  if (
    isRecord(parsed) &&
    typeof parsed["time"] === "number" &&
    typeof parsed["memory"] === "number" &&
    typeof parsed["parallelism"] === "number"
  ) {
    return { time: parsed["time"], memory: parsed["memory"], parallelism: parsed["parallelism"] };
  }
  return { time: 0, memory: 0, parallelism: 0 };
};

const toModel = (row: Selectable<AccountKeys>): AccountKeyModel => ({
  id: row.id,
  userId: row.user_id,
  agePublicKey: row.age_public_key,
  ed25519PublicKey: row.ed25519_public_key,
  escrowCt: row.escrow_ct,
  salt: row.salt,
  kdfParams: parseKdfParams(row.kdf_params),
  fingerprint: row.fingerprint,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
  revokedAt: row.revoked_at,
});

export const AccountKeyRepoLive = Layer.succeed(AccountKeyRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* d1RunWithUniqueCheck(
        async () =>
          db
            .insertInto("account_keys")
            .values({
              id: params.id,
              user_id: params.userId,
              age_public_key: params.agePublicKey,
              ed25519_public_key: params.ed25519PublicKey,
              escrow_ct: params.escrowCt,
              salt: params.salt,
              kdf_params: JSON.stringify(params.kdfParams),
              fingerprint: params.fingerprint,
              created_at: params.createdAt,
              last_used_at: null,
              revoked_at: null,
            })
            .execute(),
        "An account key is already registered for this user",
      );
    }),

  findActiveByUser: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("account_keys")
          .select(COLUMNS)
          .where("user_id", "=", params.userId)
          .where("revoked_at", "is", null)
          .executeTakeFirst(),
      );
      return row === undefined ? null : toModel(row);
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("account_keys")
          .select(COLUMNS)
          .where("id", "=", params.id)
          .executeTakeFirst(),
      );
      if (row === undefined) {
        return yield* new NotFound({ message: "Account key not found" });
      }
      return toModel(row);
    }),

  listActiveByUsers: (params) =>
    Effect.gen(function* () {
      if (params.userIds.length === 0) {
        return [];
      }
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("account_keys")
          .select(COLUMNS)
          .where("user_id", "in", params.userIds)
          .where("revoked_at", "is", null)
          .execute(),
      );
      return rows.map(toModel);
    }),

  updateEscrow: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .updateTable("account_keys")
          .set({
            escrow_ct: params.escrowCt,
            salt: params.salt,
            kdf_params: JSON.stringify(params.kdfParams),
          })
          .where("user_id", "=", params.userId)
          .where("revoked_at", "is", null)
          .execute(),
      );
    }),

  touchLastUsed: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .updateTable("account_keys")
          .set({ last_used_at: params.now })
          .where("id", "=", params.id)
          .execute(),
      );
    }),
});
