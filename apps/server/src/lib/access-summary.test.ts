import { computeAccessSummaries } from "./access-summary";

import type { PolicyAttachmentModel } from "../models";

const attachment = (
  principalType: "member" | "group",
  principalId: string,
  policyId: string,
): PolicyAttachmentModel => ({
  id: `att-${principalType}-${principalId}-${policyId}`,
  organizationId: "org-1",
  policyId,
  principalType,
  principalId,
  createdAt: "2026-01-01T00:00:00Z",
});

describe(computeAccessSummaries, () => {
  it("summarizes org role and custom-policy count", () => {
    const [summary] = computeAccessSummaries({
      members: [{ id: "m1", isOwner: false }],
      memberships: [],
      attachments: [
        attachment("member", "m1", "managed:admin"),
        attachment("member", "m1", "pol-custom"),
      ],
    });
    expect(summary).toStrictEqual({
      memberId: "m1",
      orgRole: "admin",
      adminViaGroup: false,
      customPolicyCount: 1,
    });
  });

  it("owner wins over an attached admin", () => {
    const [summary] = computeAccessSummaries({
      members: [{ id: "m1", isOwner: true }],
      memberships: [],
      attachments: [attachment("member", "m1", "managed:admin")],
    });
    expect(summary?.orgRole).toBe("owner");
  });

  it("admin via a group is flagged; group custom policies count too", () => {
    const [summary] = computeAccessSummaries({
      members: [{ id: "m1", isOwner: false }],
      memberships: [{ groupId: "g1", memberId: "m1" }],
      attachments: [
        attachment("group", "g1", "managed:admin"),
        attachment("group", "g1", "pol-team"),
        attachment("member", "m1", "pol-team"),
      ],
    });
    expect(summary?.orgRole).toBe("admin");
    expect(summary?.adminViaGroup).toBe(true);
    expect(summary?.customPolicyCount).toBe(1);
  });

  it("a member with no grants is a plain member", () => {
    const [summary] = computeAccessSummaries({
      members: [{ id: "m1", isOwner: false }],
      memberships: [],
      attachments: [],
    });
    expect(summary).toStrictEqual({
      memberId: "m1",
      orgRole: "member",
      adminViaGroup: false,
      customPolicyCount: 0,
    });
  });
});
