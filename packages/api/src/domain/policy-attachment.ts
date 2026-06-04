import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

/** Whether an attachment binds a policy to a member, a group, or an api-key. */
export const PrincipalType = Schema.Literal("member", "group", "apikey");
export type PrincipalTypeValue = typeof PrincipalType.Type;

export class PolicyAttachment extends Schema.Class<PolicyAttachment>("PolicyAttachment")({
  id: Id,
  organizationId: Id,
  // A real policy.id OR a virtual managed preset id (`managed:admin`, …).
  policyId: Schema.String,
  principalType: PrincipalType,
  principalId: Id,
  createdAt: DateTimeString,
}) {}

export const AttachPolicyBody = Schema.Struct({
  policyId: Schema.String,
});
