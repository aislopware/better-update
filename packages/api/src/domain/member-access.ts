import { Schema } from "effect";

import { Id } from "./common";

// Server-computed access summary per member — feeds the Members table's Access
// column without N+1'ing attachments per row. Reflects EFFECTIVE grants:
// direct attachments plus group-conferred ones. The only managed policy is
// `managed:admin`; everything else counts as a custom policy.

export const MemberAccessSummary = Schema.Struct({
  memberId: Id,
  /** Org role axis: owner (root) / admin (`managed:admin` attached) / member. */
  orgRole: Schema.Literal("owner", "admin", "member"),
  /** True when admin arrives via a group, not a direct attachment. */
  adminViaGroup: Schema.Boolean,
  /** Attached real (non-managed) policies, direct + via groups. */
  customPolicyCount: Schema.Number,
});

export const MemberAccessSummaryList = Schema.Struct({
  items: Schema.Array(MemberAccessSummary),
});
