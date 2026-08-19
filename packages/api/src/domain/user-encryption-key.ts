import { Schema } from "effect";

import { DateTimeString, Id, Name120 } from "./common";

/**
 * A recipient key's role. A `device` key is user-owned (works across the user's
 * orgs); `recovery` (offline break-glass) and `machine` (CI) keys are org-owned
 * and have no `userId`.
 */
export const EncryptionKeyKind = Schema.Literals(["device", "recovery", "machine"]);
export type EncryptionKeyKind = typeof EncryptionKeyKind.Type;

/** An age recipient string (`age1...`) — a public key safe for the server to hold. */
export const AgeRecipient = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isStartsWith("age1"),
).annotate({ description: "age recipient public key (age1...)" });

/** An SSH-style key fingerprint (`SHA256:...`) shown for out-of-band verification. */
export const KeyFingerprint = Schema.String.check(
  Schema.isStartsWith("SHA256:"),
  Schema.isMinLength(8),
).annotate({ description: "SSH-style key fingerprint (SHA256:...)" });

/**
 * A registered public recipient. Private keys never leave the owner's machine;
 * the server only ever holds the public half.
 */
export const UserEncryptionKey = Schema.Struct({
  id: Id,
  userId: Schema.NullOr(Id),
  organizationId: Schema.NullOr(Id),
  kind: EncryptionKeyKind,
  publicKey: AgeRecipient,
  label: Name120,
  fingerprint: KeyFingerprint,
  createdAt: DateTimeString,
  lastUsedAt: Schema.NullOr(DateTimeString),
  revokedAt: Schema.NullOr(DateTimeString),
}).annotate({ identifier: "UserEncryptionKey" });
export type UserEncryptionKey = typeof UserEncryptionKey.Type;

/**
 * Register a new public recipient (device on first use, or an org-owned
 * offline recovery key). `machine` keys are no longer registerable through
 * this public endpoint — they are created internally, alongside a bearer
 * secret, only via `credentials robot create` (see robot-accounts.ts).
 */
export const RegisterEncryptionKeyBody = Schema.Struct({
  kind: Schema.Literals(["device", "recovery"]),
  publicKey: AgeRecipient,
  label: Name120,
  fingerprint: KeyFingerprint,
});
