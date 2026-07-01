import { Context, Effect, Layer } from "effect";

import type { Selectable } from "kysely";

import { ROBOT_BEARER_PREFIX } from "../auth/constants";
import { kyselyDb } from "../cloudflare/db";
import { CryptoService } from "../domain/crypto-service";
import { NotFound } from "../errors";

import type { RobotAccount } from "../db/schema";

// -- Port -------------------------------------------------------------------

// An org-owned robot account: the single CI identity that both authenticates
// HTTP calls (bearer half) and, once linked, decrypts the credential vault (the
// `userEncryptionKeyId` half — a `user_encryption_keys` row of kind 'machine').
// The hashed bearer secret is never read out of the repository.
export interface RobotAccountModel {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly bearerStart: string | null;
  readonly hasBearer: boolean;
  readonly userEncryptionKeyId: string | null;
  readonly createdAt: string;
}

export interface CreateRobotAccountInput {
  readonly organizationId: string;
  readonly name: string;
  /** The `user_encryption_keys` (kind 'machine') row registered alongside this robot. */
  readonly userEncryptionKeyId: string;
}

export interface CreateRobotAccountResult {
  /** The plaintext bearer secret — returned ONCE, never persisted in cleartext. */
  readonly bearerSecret: string;
  readonly model: RobotAccountModel;
}

export interface RobotAccountRepository {
  /**
   * Insert an org-scoped robot account row linked to an already-registered
   * machine vault identity, minting a fresh bearer secret for it (hashed
   * exactly like the deleted apikey feature did: SHA-256 -> unpadded
   * base64url).
   */
  readonly create: (params: CreateRobotAccountInput) => Effect.Effect<CreateRobotAccountResult>;

  /** All robot accounts for an org, newest first. Never selects the hashed bearer. */
  readonly list: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly RobotAccountModel[]>;

  readonly findById: (params: {
    readonly id: string;
    readonly organizationId: string;
  }) => Effect.Effect<RobotAccountModel, NotFound>;

  /**
   * Re-mint the bearer secret only — the linked vault identity (if any) is left
   * untouched. Used both to rotate a compromised bearer and to top up a
   * vault-only robot (backfilled from a pre-existing machine key) with API
   * auth for the first time.
   */
  readonly rotateBearer: (params: {
    readonly id: string;
    readonly organizationId: string;
  }) => Effect.Effect<{ readonly bearerSecret: string }, NotFound>;

  /**
   * Delete a robot account, scoped to its org. Only removes the `robot_account`
   * row (the bearer stops authenticating immediately) — any linked vault
   * identity's `user_encryption_keys` row is untouched; vault access for it is
   * revoked the same way any other recipient is (`credentials access revoke`),
   * which the CLI runs before calling this.
   */
  readonly revoke: (params: {
    readonly id: string;
    readonly organizationId: string;
  }) => Effect.Effect<boolean>;

  /** Bearer verification for auth middleware — SHA-256 hash lookup, org-scoped result. */
  readonly verifyBearer: (params: {
    readonly plaintext: string;
  }) => Effect.Effect<{ readonly id: string; readonly organizationId: string } | null>;
}

export class RobotAccountRepo extends Context.Tag("api/RobotAccountRepo")<
  RobotAccountRepo,
  RobotAccountRepository
>() {}

// -- D1 Adapter -------------------------------------------------------------

// Same body length / charset / rejection-sampling scheme the deleted apikey
// feature used — kept identical since there's no reason to weaken it, not
// because anything still verifies against the old plugin.
const KEY_BODY_LENGTH = 64;
const START_LENGTH = 6;
const ALPHABET_SIZE = 62;

// Map an index in [0, 61] to a charcode arithmetically (no array lookup, so no
// `noUncheckedIndexedAccess` undefined): 0-25 → a-z, 26-51 → A-Z, 52-61 → 0-9.
const indexToChar = (index: number): string => {
  if (index < 26) {
    return String.fromCodePoint(97 + index);
  }
  if (index < 52) {
    return String.fromCodePoint(65 + (index - 26));
  }
  return String.fromCodePoint(48 + (index - 52));
};

// Reject-sample bytes ≥ 248 so each kept byte maps uniformly onto the 62-char
// alphabet (248 = 62 * 4); this avoids modulo bias. ~3% rejection rate.
const REJECT_THRESHOLD = 248;

// Over-sample by 2× so rejection sampling almost surely yields `length`
// survivors in one draw; recurse to top up the (astronomically rare) shortfall.
const randomKeyBody = (length: number): string => {
  const body = [...crypto.getRandomValues(new Uint8Array(length * 2))]
    .filter((byte) => byte < REJECT_THRESHOLD)
    .slice(0, length)
    .map((byte) => indexToChar(byte % ALPHABET_SIZE))
    .join("");
  return body.length === length ? body : body + randomKeyBody(length - body.length);
};

const PUBLIC_COLUMNS = [
  "id",
  "organization_id",
  "name",
  "bearer_key_hash",
  "bearer_start",
  "user_encryption_key_id",
  "created_at",
] as const;

type RobotAccountRow = Pick<Selectable<RobotAccount>, (typeof PUBLIC_COLUMNS)[number]>;

const toModel = (row: RobotAccountRow): RobotAccountModel => ({
  id: row.id,
  organizationId: row.organization_id,
  name: row.name,
  bearerStart: row.bearer_start,
  hasBearer: row.bearer_key_hash !== null,
  userEncryptionKeyId: row.user_encryption_key_id,
  createdAt: row.created_at,
});

export const RobotAccountRepoLive = Layer.effect(
  RobotAccountRepo,
  Effect.gen(function* () {
    const cryptoService = yield* CryptoService;

    const mintBearer = Effect.gen(function* () {
      const plaintext = `${ROBOT_BEARER_PREFIX}${randomKeyBody(KEY_BODY_LENGTH)}`;
      // Digest failure is unrecoverable here, so surface it as a defect (orDie)
      // — the repo's success channel carries no expected error.
      const hash = yield* cryptoService.sha256Base64Url(plaintext).pipe(Effect.orDie);
      return { plaintext, hash, start: plaintext.slice(0, START_LENGTH) };
    });

    return {
      create: (params) =>
        Effect.gen(function* () {
          const db = yield* kyselyDb;
          const bearer = yield* mintBearer;
          const id = crypto.randomUUID();
          const now = new Date().toISOString();

          const row = yield* Effect.promise(async () =>
            db
              .insertInto("robot_account")
              .values({
                id,
                organization_id: params.organizationId,
                name: params.name,
                bearer_key_hash: bearer.hash,
                bearer_start: bearer.start,
                user_encryption_key_id: params.userEncryptionKeyId,
                revoked_at: null,
              })
              .returning(PUBLIC_COLUMNS)
              .executeTakeFirst(),
          );

          const model =
            row === undefined
              ? {
                  id,
                  organizationId: params.organizationId,
                  name: params.name,
                  bearerStart: bearer.start,
                  hasBearer: true,
                  userEncryptionKeyId: params.userEncryptionKeyId,
                  createdAt: now,
                }
              : toModel(row);

          return { bearerSecret: bearer.plaintext, model };
        }),

      list: (params) =>
        Effect.gen(function* () {
          const db = yield* kyselyDb;
          const rows = yield* Effect.promise(async () =>
            db
              .selectFrom("robot_account")
              .select(PUBLIC_COLUMNS)
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
              .selectFrom("robot_account")
              .select(PUBLIC_COLUMNS)
              .where("id", "=", params.id)
              .where("organization_id", "=", params.organizationId)
              .executeTakeFirst(),
          );
          if (row === undefined) {
            return yield* new NotFound({ message: "Robot account not found" });
          }
          return toModel(row);
        }),

      rotateBearer: (params) =>
        Effect.gen(function* () {
          const db = yield* kyselyDb;
          const bearer = yield* mintBearer;
          const row = yield* Effect.promise(async () =>
            db
              .updateTable("robot_account")
              .set({ bearer_key_hash: bearer.hash, bearer_start: bearer.start })
              .where("id", "=", params.id)
              .where("organization_id", "=", params.organizationId)
              .returning(PUBLIC_COLUMNS)
              .executeTakeFirst(),
          );
          if (row === undefined) {
            return yield* new NotFound({ message: "Robot account not found" });
          }
          return { bearerSecret: bearer.plaintext };
        }),

      revoke: (params) =>
        Effect.gen(function* () {
          const db = yield* kyselyDb;
          const result = yield* Effect.promise(async () =>
            db
              .deleteFrom("robot_account")
              .where("id", "=", params.id)
              .where("organization_id", "=", params.organizationId)
              .executeTakeFirst(),
          );
          return Number(result.numDeletedRows) > 0;
        }),

      verifyBearer: (params) =>
        Effect.gen(function* () {
          const db = yield* kyselyDb;
          const hash = yield* cryptoService.sha256Base64Url(params.plaintext).pipe(Effect.orDie);
          const row = yield* Effect.promise(async () =>
            db
              .selectFrom("robot_account")
              .select(["id", "organization_id"])
              .where("bearer_key_hash", "=", hash)
              .executeTakeFirst(),
          );
          return row === undefined ? null : { id: row.id, organizationId: row.organization_id };
        }),
    } satisfies RobotAccountRepository;
  }),
);
