import { actorHolds } from "./me";

import type { PolicyStatement } from "../authz-models";
import type { CurrentActor } from "../models";

// `actorHolds(ctx, token)` is the server-computed capability the Members UI gates
// each affordance on, mirroring the EXACT token its endpoint gates on:
// invitation:create (Invite), member:delete (Remove), policy:update (Manage
// policies). It must never report a capability the server would 403. Owner and
// superadmin are unconditional roots (same bypass order as assertAccess), and the
// member ROLE string grants nothing: capability is purely attachment-derived.

const baseActor: CurrentActor = {
  userId: "u1",
  organizationId: "org-1",
  memberId: "m1",
  // A non-"owner" role string — the capability ignores role entirely.
  role: "member",
  isOwner: false,
  effectiveStatements: [],
  source: "session",
  transport: "cookie",
  actorEmail: "dev@example.com",
  isSuperadmin: false,
};

const actor = (overrides: Partial<CurrentActor>): CurrentActor => ({ ...baseActor, ...overrides });

const allow = (actions: string[], resources: string[]): PolicyStatement => ({
  effect: "allow",
  actions,
  resources,
});

const deny = (actions: string[], resources: string[]): PolicyStatement => ({
  effect: "deny",
  actions,
  resources,
});

describe(actorHolds, () => {
  it("owner + superadmin hold every token (no statements needed)", () => {
    for (const token of ["invitation:create", "member:delete", "policy:update"]) {
      expect(actorHolds(actor({ isOwner: true }), token)).toBe(true);
      expect(actorHolds(actor({ isSuperadmin: true }), token)).toBe(true);
    }
  });

  it("a role-'member' principal with NO statements holds nothing (default-deny)", () => {
    for (const token of ["invitation:create", "member:delete", "policy:update"]) {
      expect(actorHolds(actor({}), token)).toBe(false);
    }
  });

  it("each capability is the EXACT token its endpoint gates on (no conflation)", () => {
    // A member:delete grant lets you Remove but NOT Invite or Manage policies.
    const remover = actor({ effectiveStatements: [allow(["member:delete"], ["org"])] });
    expect(actorHolds(remover, "member:delete")).toBe(true);
    expect(actorHolds(remover, "invitation:create")).toBe(false);
    expect(actorHolds(remover, "policy:update")).toBe(false);

    // A policy:update grant lets you Manage policies but NOT Remove or Invite.
    const policyManager = actor({ effectiveStatements: [allow(["policy:update"], ["org"])] });
    expect(actorHolds(policyManager, "policy:update")).toBe(true);
    expect(actorHolds(policyManager, "member:delete")).toBe(false);
  });

  it("an org-wide wildcard grant holds all three (managed:admin shape)", () => {
    const admin = actor({ effectiveStatements: [allow(["*"], ["*"])] });
    for (const token of ["invitation:create", "member:delete", "policy:update"]) {
      expect(actorHolds(admin, token)).toBe(true);
    }
  });

  it("a deny wins over an allow for the same token", () => {
    const denied = actor({
      effectiveStatements: [allow(["member:*"], ["org"]), deny(["member:delete"], ["org"])],
    });
    expect(actorHolds(denied, "member:delete")).toBe(false);
  });
});
