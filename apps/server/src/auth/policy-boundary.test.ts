import { isWithinBoundary } from "./policy-boundary";

import type { PolicyDocument, PolicyStatement } from "../authz-models";

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
const doc = (...statements: PolicyStatement[]): PolicyDocument => ({ statements });

describe(isWithinBoundary, () => {
  it("an empty or allow-free document is always within bounds", () => {
    expect(isWithinBoundary([], doc())).toBe(true);
    expect(isWithinBoundary([], doc(deny(["*"], ["*"])))).toBe(true);
  });

  it("blocks granting more than the caller holds (policy:update cannot mint admin)", () => {
    const caller = [allow(["policy:update"], ["*"])];
    const adminLike = doc(allow(["member:create", "policy:create"], ["*"]));
    expect(isWithinBoundary(caller, adminLike)).toBe(false);
  });

  it("an admin (allow * on *) can grant any subset", () => {
    const admin = [allow(["*"], ["*"])];
    expect(isWithinBoundary(admin, doc(allow(["channel:read"], ["project/A"])))).toBe(true);
    expect(isWithinBoundary(admin, doc(allow(["*"], ["*"])))).toBe(true);
  });

  it("a resource:* caller token subsumes a concrete action on that resource only", () => {
    const caller = [allow(["channel:*"], ["*"])];
    expect(isWithinBoundary(caller, doc(allow(["channel:create"], ["project/A"])))).toBe(true);
    expect(isWithinBoundary(caller, doc(allow(["build:create"], ["project/A"])))).toBe(false);
  });

  it("a project-scoped caller cannot grant org-wide or a sibling project", () => {
    const caller = [allow(["channel:*"], ["project/A"])];
    expect(isWithinBoundary(caller, doc(allow(["channel:create"], ["*"])))).toBe(false);
    expect(isWithinBoundary(caller, doc(allow(["channel:create"], ["project/B"])))).toBe(false);
    // but may grant within / below its own scope
    expect(isWithinBoundary(caller, doc(allow(["channel:create"], ["project/A/channel/X"])))).toBe(
      true,
    );
  });

  it("a caller deny blocks granting an intersecting allow", () => {
    const caller = [allow(["*"], ["*"]), deny(["channel:delete"], ["project/A"])];
    expect(isWithinBoundary(caller, doc(allow(["channel:delete"], ["project/A"])))).toBe(false);
    expect(isWithinBoundary(caller, doc(allow(["channel:delete"], ["project/B"])))).toBe(true);
  });

  it("every (action, resource) pair in the grant must be individually covered", () => {
    const caller = [allow(["channel:create"], ["project/A"])];
    expect(
      isWithinBoundary(caller, doc(allow(["channel:create", "channel:delete"], ["project/A"]))),
    ).toBe(false);
  });
});
