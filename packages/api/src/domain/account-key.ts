import { Schema } from "effect";

import { DateTimeString, Id } from "./common";
import { AgeRecipient, KeyFingerprint } from "./user-encryption-key";

/**
 * Argon2id cost parameters carried in an account-key escrow header. The browser
 * re-derives the KEK with these to open the escrow, so they travel with the blob
 * (an enrollment can use heavier params without a format change).
 */
export const AccountKeyKdfParams = Schema.Struct({
  time: Schema.Number.pipe(Schema.int(), Schema.positive()),
  memory: Schema.Number.pipe(Schema.int(), Schema.positive()),
  parallelism: Schema.Number.pipe(Schema.int(), Schema.positive()),
});
export type AccountKeyKdfParams = typeof AccountKeyKdfParams.Type;

/** A base64 Ed25519 public key — reserved for the deferred signed-roster integrity layer. */
export const Ed25519PublicKey = Schema.String.pipe(Schema.minLength(1)).annotations({
  description: "base64-encoded Ed25519 public key (reserved for signed-roster integrity)",
});

/**
 * A per-user account key's PUBLIC view (no escrow ciphertext). The age public key
 * is the env-vault recipient the browser unwraps with; the escrow that holds the
 * private halves is served only by the gated {@link AccountKeyEscrow} endpoint.
 */
export class AccountKey extends Schema.Class<AccountKey>("AccountKey")({
  id: Id,
  userId: Id,
  agePublicKey: AgeRecipient,
  ed25519PublicKey: Ed25519PublicKey,
  fingerprint: KeyFingerprint,
  createdAt: DateTimeString,
  lastUsedAt: Schema.NullOr(DateTimeString),
  revokedAt: Schema.NullOr(DateTimeString),
}) {}

/**
 * The full passphrase-sealed escrow for the caller — everything the browser needs
 * to open it locally ({@link AccountKeyKdfParams} + salt + ciphertext). The server
 * stores it opaquely and can never open it. Served by the `getMe` endpoint, which
 * is gated on vault participation; a 2FA step-up for browser sessions is REQUIRED
 * before any web consumer ships but is not yet implemented (P4). The contents stay
 * passphrase-sealed regardless. `version`/`kdf`/`cipher` are the fixed v1 envelope
 * constants, echoed so the browser can rebuild the crypto envelope.
 */
export class AccountKeyEscrow extends Schema.Class<AccountKeyEscrow>("AccountKeyEscrow")({
  id: Id,
  version: Schema.Literal(1),
  agePublicKey: AgeRecipient,
  ed25519PublicKey: Ed25519PublicKey,
  fingerprint: KeyFingerprint,
  kdf: Schema.Literal("argon2id"),
  kdfParams: AccountKeyKdfParams,
  salt: Schema.String.pipe(Schema.minLength(1)),
  cipher: Schema.Literal("xchacha20poly1305"),
  escrowCt: Schema.String.pipe(Schema.minLength(1)),
  createdAt: DateTimeString,
}) {}

/**
 * Register the caller's account key. The CLI generates the keypair and seals the
 * private halves under the passphrase BEFORE calling this — the server only ever
 * receives the public keys + the opaque escrow ciphertext + its KDF header.
 */
export const RegisterAccountKeyBody = Schema.Struct({
  agePublicKey: AgeRecipient,
  ed25519PublicKey: Ed25519PublicKey,
  fingerprint: KeyFingerprint,
  kdfParams: AccountKeyKdfParams,
  salt: Schema.String.pipe(Schema.minLength(1)),
  escrowCt: Schema.String.pipe(Schema.minLength(1)),
});

/**
 * The org's members' live account keys (public view). The env-vault cutover and
 * rotation fetch it to enumerate the account-key recipients and resolve each
 * `account_keys.id` to the `age` recipient the new env key is wrapped to.
 */
export const AccountKeyList = Schema.Struct({ items: Schema.Array(AccountKey) });

/**
 * Re-seal the caller's account-key escrow under a new passphrase (the CLI
 * `passphrase change` flow). The keypair itself is unchanged — only the
 * passphrase-derived seal — so every env-vault wrap to it stays valid.
 */
export const ResealAccountKeyBody = Schema.Struct({
  kdfParams: AccountKeyKdfParams,
  salt: Schema.String.pipe(Schema.minLength(1)),
  escrowCt: Schema.String.pipe(Schema.minLength(1)),
});
