import { Schema } from "effect";

import { DateTimeString, Id, Name120 } from "./common";
import { ProjectMemberRole } from "./project-member";
import { AgeRecipient, KeyFingerprint } from "./user-encryption-key";

// A PROJECT-scoped robot account (GITLAB-RBAC-SPEC §1b, v2): the single CI
// identity that both authenticates HTTP calls (bearer secret) and, once
// linked, decrypts the credential vault (a `user_encryption_keys` row of kind
// 'machine', registered alongside it). One robot = one project + one project
// role + one bearer — all invariants since migration 0094 dropped the legacy
// pre-v2 rows. The hashed bearer secret is NEVER exposed — only `bearerStart`
// (the first few characters of the plaintext, incl. the prefix) so a masked
// CI variable can be matched back to its robot.
export class RobotAccount extends Schema.Class<RobotAccount>("RobotAccount")({
  id: Id,
  organizationId: Id,
  name: Name120,
  bearerStart: Schema.String,
  userEncryptionKeyId: Schema.NullOr(Id),
  projectId: Id,
  role: ProjectMemberRole,
  createdAt: DateTimeString,
}) {}

// A freshly-minted robot account. Extends {@link RobotAccount} with the
// plaintext `bearerSecret` — returned ONCE at creation, never persisted in
// cleartext.
export class CreatedRobotAccount extends Schema.Class<CreatedRobotAccount>("CreatedRobotAccount")({
  id: Id,
  organizationId: Id,
  name: Name120,
  bearerStart: Schema.String,
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

// Optional server-side project scope for the list (the dashboard's per-project
// robots tab); omitted = every robot visible to the actor.
export const ListRobotAccountsParams = Schema.Struct({ projectId: Schema.optional(Id) });

export const RobotAccountList = Schema.Struct({ items: Schema.Array(RobotAccount) });
