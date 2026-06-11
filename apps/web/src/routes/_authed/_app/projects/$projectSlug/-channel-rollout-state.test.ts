import { parseRolloutState } from "./-channel-rollout-state";

describe(parseRolloutState, () => {
  it("parses the legacy string form", () => {
    const json = JSON.stringify({
      data: [
        { branchId: "branch-next", branchMappingLogic: "hash_lt(mappingId, 0.50)" },
        { branchId: "branch-main", branchMappingLogic: "true" },
      ],
      salt: "salt",
    });

    expect(parseRolloutState(json)).toStrictEqual({
      targetBranchId: "branch-next",
      percentage: 50,
    });
  });

  it("parses the structured node form written by the rollout API", () => {
    const json = JSON.stringify({
      data: [
        {
          branchId: "branch-next",
          branchMappingLogic: {
            clientKey: "rolloutToken",
            branchMappingOperator: "hash_lt",
            operand: 0.25,
          },
        },
        { branchId: "branch-main", branchMappingLogic: "true" },
      ],
      salt: "salt",
    });

    expect(parseRolloutState(json)).toStrictEqual({
      targetBranchId: "branch-next",
      percentage: 25,
    });
  });

  it("returns null when no rollout leaf is present", () => {
    const json = JSON.stringify({
      data: [{ branchId: "branch-main", branchMappingLogic: "true" }],
      salt: "salt",
    });

    expect(parseRolloutState(json)).toBeNull();
  });
});
