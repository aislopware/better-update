import { Schema } from "effect";

import { DateTimeString, Id, Name120 } from "./common";
import { AgeRecipient, KeyFingerprint } from "./user-encryption-key";

// An org-owned robot account: the single CI identity that both authenticates
// HTTP calls (bearer secret) and, once linked, decrypts the credential vault
// (a `user_encryption_keys` row of kind 'machine', registered alongside it).
// The hashed bearer secret is NEVER exposed — only `bearerStart` (the first few
// characters of the plaintext, incl. the prefix) for UI identification.
export class RobotAccount extends Schema.Class<RobotAccount>("RobotAccount")({
  id: Id,
  organizationId: Id,
  name: Name120,
  bearerStart: Schema.NullOr(Schema.String),
  hasBearer: Schema.Boolean,
  userEncryptionKeyId: Schema.NullOr(Id),
  createdAt: DateTimeString,
}) {}

// A freshly-minted robot account. Extends {@link RobotAccount} with the
// plaintext `bearerSecret` and the vault identity's `privateKey` — both
// returned ONCE at creation and never persisted in cleartext.
export class CreatedRobotAccount extends Schema.Class<CreatedRobotAccount>("CreatedRobotAccount")({
  id: Id,
  organizationId: Id,
  name: Name120,
  bearerStart: Schema.NullOr(Schema.String),
  hasBearer: Schema.Boolean,
  userEncryptionKeyId: Schema.NullOr(Id),
  createdAt: DateTimeString,
  bearerSecret: Schema.String,
}) {}

// The age keypair is generated client-side (zero-knowledge) — only the public
// half + fingerprint ever reach the server, alongside the name for the vault
// identity's label.
export const CreateRobotAccountBody = Schema.Struct({
  name: Name120,
  publicKey: AgeRecipient,
  fingerprint: KeyFingerprint,
});

// A re-minted bearer secret (rotate). Leaves any linked vault identity untouched.
export class RotatedRobotAccountBearer extends Schema.Class<RotatedRobotAccountBearer>(
  "RotatedRobotAccountBearer",
)({
  bearerSecret: Schema.String,
}) {}

export const RobotAccountList = Schema.Struct({ items: Schema.Array(RobotAccount) });
