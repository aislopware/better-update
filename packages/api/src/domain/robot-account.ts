import { Schema } from "effect";

import { DateTimeString, Id, Name120 } from "./common";
import { ProjectMemberRole } from "./project-member";
import { AgeRecipient, KeyFingerprint } from "./user-encryption-key";

// A PROJECT-scoped robot account (GITLAB-RBAC-SPEC §1b, v2): the single CI
// identity that both authenticates HTTP calls (bearer secret) and, once
// linked, decrypts the credential vault (a `user_encryption_keys` row of kind
// 'machine', registered alongside it). One robot = one project + one project
// role — its whole authorization. The hashed bearer secret is NEVER exposed —
// only `bearerStart` (the first few characters of the plaintext, incl. the
// prefix) for UI identification. `projectId`/`role` are null ONLY on legacy
// pre-v2 rows, which never authenticate and exist to be revoked.
export class RobotAccount extends Schema.Class<RobotAccount>("RobotAccount")({
  id: Id,
  organizationId: Id,
  name: Name120,
  bearerStart: Schema.NullOr(Schema.String),
  hasBearer: Schema.Boolean,
  userEncryptionKeyId: Schema.NullOr(Id),
  projectId: Schema.NullOr(Id),
  role: Schema.NullOr(ProjectMemberRole),
  createdAt: DateTimeString,
}) {}

// A freshly-minted robot account. Extends {@link RobotAccount} with the
// plaintext `bearerSecret` — returned ONCE at creation, never persisted in
// cleartext.
export class CreatedRobotAccount extends Schema.Class<CreatedRobotAccount>("CreatedRobotAccount")({
  id: Id,
  organizationId: Id,
  name: Name120,
  bearerStart: Schema.NullOr(Schema.String),
  hasBearer: Schema.Boolean,
  userEncryptionKeyId: Schema.NullOr(Id),
  projectId: Id,
  role: ProjectMemberRole,
  createdAt: DateTimeString,
  bearerSecret: Schema.String,
}) {}

// The age keypair is generated client-side (zero-knowledge) — only the public
// half + fingerprint ever reach the server, alongside the name for the vault
// identity's label. The robot is born on exactly one project with one role;
// the server gates creation on Maintainer of that project.
export const CreateRobotAccountBody = Schema.Struct({
  name: Name120,
  publicKey: AgeRecipient,
  fingerprint: KeyFingerprint,
  projectId: Id,
  role: ProjectMemberRole,
});

// A re-minted bearer secret (rotate). Leaves any linked vault identity untouched.
export class RotatedRobotAccountBearer extends Schema.Class<RotatedRobotAccountBearer>(
  "RotatedRobotAccountBearer",
)({
  bearerSecret: Schema.String,
}) {}

export const RobotAccountList = Schema.Struct({ items: Schema.Array(RobotAccount) });
