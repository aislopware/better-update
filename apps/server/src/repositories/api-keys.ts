import { Context, Effect, Layer } from "effect";

import { API_KEY_PREFIX } from "../auth/constants";
import { cloudflareEnv } from "../cloudflare/context";
import { CryptoService } from "../domain/crypto-service";

// -- Port -------------------------------------------------------------------

// An organization API key, minus the hashed secret (`apikey.key`), which is
// never read out of the repository. Lives here (not models.ts) since the repo +
// handler are its only consumers.
export interface ApiKeyModel {
  readonly id: string;
  readonly name: string | null;
  readonly start: string | null;
  readonly prefix: string | null;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly expiresAt: string | null;
}

export interface MintApiKeyInput {
  readonly organizationId: string;
  readonly name: string;
  /** Absolute expiry as an ISO 8601 string, or `null` for a non-expiring key. */
  readonly expiresAt: string | null;
}

export interface MintApiKeyResult {
  /** The plaintext key — returned ONCE, never persisted in cleartext. */
  readonly key: string;
  readonly model: ApiKeyModel;
}

export interface ApiKeyRepository {
  /**
   * Mint an org-scoped API key: generate a random plaintext, hash it exactly as
   * the better-auth api-key plugin's `verifyApiKey` expects (SHA-256 →
   * unpadded base64url), and INSERT a row into `apikey` whose columns match the
   * plugin config (`config_id = "default"`, `reference_id = organizationId`,
   * `enabled = 1`, the configured rate-limit fields). Returns the plaintext +
   * the persisted model.
   */
  readonly mint: (params: MintApiKeyInput) => Effect.Effect<MintApiKeyResult>;

  /** All API keys for an org, newest first. Never selects the hashed `key`. */
  readonly list: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly ApiKeyModel[]>;

  /**
   * Delete a key, scoped to its org so no caller can revoke another org's key.
   * Returns `false` when the id is absent in this org.
   */
  readonly revoke: (params: {
    readonly id: string;
    readonly organizationId: string;
  }) => Effect.Effect<boolean>;
}

export class ApiKeyRepo extends Context.Tag("api/ApiKeyRepo")<ApiKeyRepo, ApiKeyRepository>() {}

// -- D1 Adapter -------------------------------------------------------------

// Plugin config defaults (auth.ts): single config `default`, references
// `organization`, rate limit on with a 60s window / 120 requests. These are
// stamped onto every minted row so the better-auth verify path reads identical
// values to a key the plugin would have created itself.
const CONFIG_ID = "default";
const RATE_LIMIT_ENABLED = 1;
const RATE_LIMIT_TIME_WINDOW = 60_000;
const RATE_LIMIT_MAX = 120;

// better-auth's `defaultKeyLength` is 64 and its `startingCharactersConfig`
// stores the first 6 characters (incl. prefix) in `start`. We mirror both so a
// minted key is indistinguishable from a plugin-created one in the UI.
const KEY_BODY_LENGTH = 64;
const START_LENGTH = 6;

// Alphanumeric body charset (a-z, A-Z, 0-9), 62 symbols. The plugin uses
// a-z + A-Z; adding digits only widens the space. Verification hashes the whole
// plaintext, so any sufficiently-random body works as long as the hash matches.
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

interface ApiKeyRow {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  enabled: number | null;
  created_at: string;
  expires_at: string | null;
}

const toModel = (row: ApiKeyRow): ApiKeyModel => ({
  id: row.id,
  name: row.name,
  start: row.start,
  prefix: row.prefix,
  enabled: row.enabled === 1,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
});

// The non-secret columns surfaced to callers — the hashed `key` is deliberately
// excluded so it can never leak through list/mint responses.
const PUBLIC_COLUMNS = `"id", "name", "start", "prefix", "enabled", "created_at", "expires_at"`;

export const ApiKeyRepoLive = Layer.effect(
  ApiKeyRepo,
  Effect.gen(function* () {
    const cryptoService = yield* CryptoService;

    return {
      mint: (params) =>
        Effect.gen(function* () {
          const env = yield* cloudflareEnv;
          const prefix = API_KEY_PREFIX;
          const plaintext = `${prefix}${randomKeyBody(KEY_BODY_LENGTH)}`;
          // Hash exactly as the plugin: SHA-256 → unpadded base64url. `verifyApiKey`
          // looks the row up by this hash, so it must be byte-identical. A digest
          // failure is unrecoverable here, so surface it as a defect (orDie) —
          // the repo's success channel carries no expected error.
          const hash = yield* cryptoService.sha256Base64Url(plaintext).pipe(Effect.orDie);
          const start = plaintext.slice(0, START_LENGTH);
          const id = crypto.randomUUID();
          const now = new Date().toISOString();

          const row = yield* Effect.promise(async () =>
            env.DB.prepare(
              `INSERT INTO "apikey" (
                 "id", "config_id", "name", "start", "reference_id", "prefix", "key",
                 "enabled", "rate_limit_enabled", "rate_limit_time_window", "rate_limit_max",
                 "request_count", "permissions", "expires_at", "created_at", "updated_at"
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               RETURNING ${PUBLIC_COLUMNS}`,
            )
              .bind(
                id,
                CONFIG_ID,
                params.name,
                start,
                params.organizationId,
                prefix,
                hash,
                1,
                RATE_LIMIT_ENABLED,
                RATE_LIMIT_TIME_WINDOW,
                RATE_LIMIT_MAX,
                0,
                null,
                params.expiresAt,
                now,
                now,
              )
              .first<ApiKeyRow>(),
          );

          const model =
            row === null
              ? {
                  id,
                  name: params.name,
                  start,
                  prefix,
                  enabled: true,
                  createdAt: now,
                  expiresAt: params.expiresAt,
                }
              : toModel(row);

          return { key: plaintext, model };
        }),

      list: (params) =>
        Effect.gen(function* () {
          const env = yield* cloudflareEnv;
          const rows = yield* Effect.promise(async () =>
            env.DB.prepare(
              `SELECT ${PUBLIC_COLUMNS} FROM "apikey" WHERE "reference_id" = ? ORDER BY "created_at" DESC`,
            )
              .bind(params.organizationId)
              .all<ApiKeyRow>(),
          );
          return rows.results.map(toModel);
        }),

      revoke: (params) =>
        Effect.gen(function* () {
          const env = yield* cloudflareEnv;
          const result = yield* Effect.promise(async () =>
            env.DB.prepare(`DELETE FROM "apikey" WHERE "id" = ? AND "reference_id" = ?`)
              .bind(params.id, params.organizationId)
              .run(),
          );
          return result.meta.changes > 0;
        }),
    } satisfies ApiKeyRepository;
  }),
);
