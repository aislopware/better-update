import { actionMatches, isAllowed, resolvePath, selectorMatches } from "./policy-match";

import type { ObjectRef, PolicyStatement } from "../authz-models";

describe(actionMatches, () => {
  it("exact token matches", () => {
    expect(actionMatches(["update:create"], "update:create")).toBe(true);
  });
  it("resource wildcard matches any action on the resource", () => {
    expect(actionMatches(["channel:*"], "channel:read")).toBe(true);
    expect(actionMatches(["channel:*"], "update:read")).toBe(false);
  });
  it("global wildcard matches everything", () => {
    expect(actionMatches(["*"], "billing:update")).toBe(true);
  });
  it("no match → false", () => {
    expect(actionMatches(["update:read"], "update:create")).toBe(false);
    expect(actionMatches([], "update:create")).toBe(false);
  });
});

describe(selectorMatches, () => {
  it("global wildcard matches any path", () => {
    expect(selectorMatches("*", "project/A/channel/X")).toBe(true);
    expect(selectorMatches("*", "org")).toBe(true);
  });
  it("prefix selector matches the whole subtree", () => {
    expect(selectorMatches("project/A", "project/A")).toBe(true);
    expect(selectorMatches("project/A", "project/A/channel/X/update/1")).toBe(true);
  });
  it("segment wildcard matches one segment", () => {
    expect(selectorMatches("project/*/env/production", "project/B/env/production")).toBe(true);
    expect(selectorMatches("project/*/env/production", "project/B/env/staging")).toBe(false);
  });
  it("a selector deeper than the target never matches", () => {
    expect(selectorMatches("project/A/channel/X", "project/A")).toBe(false);
  });
  it("project selector does not match the org path", () => {
    expect(selectorMatches("project/A", "org")).toBe(false);
  });
  it("different project id does not match", () => {
    expect(selectorMatches("project/A", "project/B/channel/X")).toBe(false);
  });
  it("does not leak across an id prefix collision (segment equality, not substring)", () => {
    expect(selectorMatches("project/A", "project/AB")).toBe(false);
    expect(selectorMatches("project/A/channel/X", "project/A/channel/XY")).toBe(false);
  });
});

describe(resolvePath, () => {
  const cases: readonly (readonly [ObjectRef, string])[] = [
    [{ kind: "org" }, "org"],
    [{ kind: "project", projectId: "A" }, "project/A"],
    [{ kind: "build", projectId: "A", buildId: "b1" }, "project/A/build/b1"],
    [{ kind: "build", projectId: "A" }, "project/A/build"],
    [{ kind: "credential", projectId: "A", credentialId: "c1" }, "project/A/credential/c1"],
    [{ kind: "submission", projectId: "A", submissionId: "s1" }, "project/A/submission/s1"],
    [
      { kind: "environment", projectId: "A", environment: "production" },
      "project/A/env/production",
    ],
    [
      { kind: "envVar", projectId: "global", environment: "production", key: "API_URL" },
      "project/global/env/production/envVar/API_URL",
    ],
    [{ kind: "envVar", projectId: "A", environment: "preview" }, "project/A/env/preview/envVar"],
    [{ kind: "channel", projectId: "A", channelId: "ch1" }, "project/A/channel/ch1"],
    [
      { kind: "update", projectId: "A", channelId: "ch1", updateId: "u1" },
      "project/A/channel/ch1/update/u1",
    ],
    [{ kind: "rollout", projectId: "A", channelId: "ch1" }, "project/A/channel/ch1/rollout"],
  ];
  it.each(cases)("%o → %s", (ref, expected) => {
    expect(resolvePath(ref)).toBe(expected);
  });
});

describe("isAllowed (deny-wins, default-deny)", () => {
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

  it("default deny with no statements", () => {
    expect(isAllowed([], "update:create", "project/A/channel/X")).toBe(false);
  });
  it("matching allow grants access", () => {
    expect(
      isAllowed([allow(["update:*"], ["project/A"])], "update:create", "project/A/channel/X"),
    ).toBe(true);
  });
  it("deny wins over an allow on the same path", () => {
    const stmts = [allow(["update:*"], ["*"]), deny(["update:create"], ["project/A"])];
    expect(isAllowed(stmts, "update:create", "project/A/channel/X")).toBe(false);
  });
  it("allow on a different scope does not leak", () => {
    expect(
      isAllowed([allow(["update:create"], ["project/B"])], "update:create", "project/A/channel/X"),
    ).toBe(false);
  });
  it("action must match too", () => {
    expect(isAllowed([allow(["channel:read"], ["*"])], "update:create", "project/A")).toBe(false);
  });
});
