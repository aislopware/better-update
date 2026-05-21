import { Schema } from "effect";

import { DateTimeString, Id, Name120 } from "./common";

/**
 * A recipient key's role. A `device` key is user-owned (works across the user's
 * orgs); `recovery` (offline break-glass) and `machine` (CI) keys are org-owned
 * and have no `userId`.
 */
export const EncryptionKeyKind = Schema.Literal("device", "recovery", "machine");
export type EncryptionKeyKind = typeof EncryptionKeyKind.Type;

/** An age recipient string (`age1...`) — a public key safe for the server to hold. */
export const AgeRecipient = Schema.String.pipe(
  Schema.minLength(1),
  Schema.startsWith("age1"),
).annotations({ description: "age recipient public key (age1...)" });

/** An SSH-style key fingerprint (`SHA256:...`) shown for out-of-band verification. */
export const KeyFingerprint = Schema.String.pipe(
  Schema.startsWith("SHA256:"),
  Schema.minLength(8),
).annotations({ description: "SSH-style key fingerprint (SHA256:...)" });

/**
 * A registered public recipient. Private keys never leave the owner's machine;
 * the server only ever holds the public half.
 */
export class UserEncryptionKey extends Schema.Class<UserEncryptionKey>("UserEncryptionKey")({
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
}) {}

/** Register a new public recipient (device on first use, or a CI/recovery key). */
export const RegisterEncryptionKeyBody = Schema.Struct({
  kind: EncryptionKeyKind,
  publicKey: AgeRecipient,
  label: Name120,
  fingerprint: KeyFingerprint,
});
