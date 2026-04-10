import {
  buildBranchMapping,
  evaluateBranchMapping,
  extractNewBranchId,
  updateBranchMappingPercentage,
} from "./branch-mapping";

describe(buildBranchMapping, () => {
  test("produces correct JSON with two entries", () => {
    const result = buildBranchMapping({
      newBranchId: "new-branch-1",
      oldBranchId: "old-branch-1",
      percentage: 25,
      salt: "salt-uuid",
    });

    const parsed = JSON.parse(result);
    expect(parsed.data).toHaveLength(2);
    expect(parsed.data[0].branchId).toBe("new-branch-1");
    expect(parsed.data[0].branchMappingLogic).toBe("hash_lt(mappingId, 0.25)");
    expect(parsed.data[1].branchId).toBe("old-branch-1");
    expect(parsed.data[1].branchMappingLogic).toBe("true");
    expect(parsed.salt).toBe("salt-uuid");
  });

  test("formats percentage correctly", () => {
    const result = buildBranchMapping({
      newBranchId: "new",
      oldBranchId: "old",
      percentage: 10,
      salt: "s",
    });

    const parsed = JSON.parse(result);
    expect(parsed.data[0].branchMappingLogic).toBe("hash_lt(mappingId, 0.10)");
  });

  test("handles 100% rollout", () => {
    const result = buildBranchMapping({
      newBranchId: "new",
      oldBranchId: "old",
      percentage: 100,
      salt: "s",
    });

    const parsed = JSON.parse(result);
    expect(parsed.data[0].branchMappingLogic).toBe("hash_lt(mappingId, 1.00)");
  });
});

describe(updateBranchMappingPercentage, () => {
  test("updates threshold in first entry and preserves salt and fallback", () => {
    const original = buildBranchMapping({
      newBranchId: "new-1",
      oldBranchId: "old-1",
      percentage: 10,
      salt: "my-salt",
    });

    const updated = updateBranchMappingPercentage(original, 50);
    const parsed = JSON.parse(updated);

    expect(parsed.data[0].branchMappingLogic).toBe("hash_lt(mappingId, 0.50)");
    expect(parsed.data[0].branchId).toBe("new-1");
    expect(parsed.data[1].branchId).toBe("old-1");
    expect(parsed.data[1].branchMappingLogic).toBe("true");
    expect(parsed.salt).toBe("my-salt");
  });
});

describe(extractNewBranchId, () => {
  test("returns first entry branchId", () => {
    const mapping = buildBranchMapping({
      newBranchId: "target-branch",
      oldBranchId: "fallback-branch",
      percentage: 30,
      salt: "s",
    });

    expect(extractNewBranchId(mapping)).toBe("target-branch");
  });
});

describe(evaluateBranchMapping, () => {
  const newBranchId = "branch-new";
  const oldBranchId = "branch-old";
  const salt = "test-salt-uuid";

  test("returns fallback branch when no clientId is provided", async () => {
    const mapping = buildBranchMapping({
      newBranchId,
      oldBranchId,
      percentage: 50,
      salt,
    });

    const result = await evaluateBranchMapping(mapping, undefined);
    expect(result).toBe(oldBranchId);
  });

  test("is deterministic for same salt + clientId", async () => {
    const mapping = buildBranchMapping({
      newBranchId,
      oldBranchId,
      percentage: 50,
      salt,
    });

    const clientId = "client-abc-123";
    const result1 = await evaluateBranchMapping(mapping, clientId);
    const result2 = await evaluateBranchMapping(mapping, clientId);
    const result3 = await evaluateBranchMapping(mapping, clientId);

    expect(result1).toBe(result2);
    expect(result2).toBe(result3);
  });

  test("at 100% threshold all clients get new branch", async () => {
    const mapping = buildBranchMapping({
      newBranchId,
      oldBranchId,
      percentage: 100,
      salt,
    });

    const clientIds = ["client-1", "client-2", "client-3", "client-4", "client-5"];
    const results = await Promise.all(
      clientIds.map(async (clientId) => evaluateBranchMapping(mapping, clientId)),
    );
    results.forEach((result) => expect(result).toBe(newBranchId));
  });

  test("at 0% threshold no clients get new branch", async () => {
    const mapping = JSON.stringify({
      data: [
        { branchId: newBranchId, branchMappingLogic: "hash_lt(mappingId, 0.00)" },
        { branchId: oldBranchId, branchMappingLogic: "true" },
      ],
      salt,
    });

    const clientIds = ["client-1", "client-2", "client-3", "client-4", "client-5"];
    const results = await Promise.all(
      clientIds.map(async (clientId) => evaluateBranchMapping(mapping, clientId)),
    );
    results.forEach((result) => expect(result).toBe(oldBranchId));
  });

  test("skips entries with unrecognized branchMappingLogic", async () => {
    const mapping = JSON.stringify({
      data: [
        { branchId: newBranchId, branchMappingLogic: "unknown_operator(foo, 0.50)" },
        { branchId: oldBranchId, branchMappingLogic: "true" },
      ],
      salt,
    });

    const result = await evaluateBranchMapping(mapping, "any-client");
    expect(result).toBe(oldBranchId);
  });

  test("handles malformed JSON gracefully", async () => {
    const mapping = JSON.stringify({ notData: true });
    const result = await evaluateBranchMapping(mapping, "any-client");
    expect(result).toBe("");
  });

  test("hash correctness for known salt + clientId", async () => {
    // Compute the expected hash manually for verification
    const testSalt = "known-salt";
    const testClientId = "known-client";
    const input = new TextEncoder().encode(`${testSalt}:${testClientId}`);
    const hashBuffer = await crypto.subtle.digest("SHA-256", input);
    const view = new DataView(hashBuffer);
    const uint32 = view.getUint32(0, false);
    const expectedValue = uint32 / 4_294_967_296;

    // Use a threshold that we know the value falls on the correct side of
    const thresholdAbove = Math.min(expectedValue + 0.01, 1);
    const thresholdBelow = Math.max(expectedValue - 0.01, 0);

    // With threshold above the hash value, client should get new branch
    const mappingAbove = JSON.stringify({
      data: [
        {
          branchId: newBranchId,
          branchMappingLogic: `hash_lt(mappingId, ${thresholdAbove.toFixed(10)})`,
        },
        { branchId: oldBranchId, branchMappingLogic: "true" },
      ],
      salt: testSalt,
    });
    const resultAbove = await evaluateBranchMapping(mappingAbove, testClientId);
    expect(resultAbove).toBe(newBranchId);

    // With threshold below the hash value, client should get old branch
    const mappingBelow = JSON.stringify({
      data: [
        {
          branchId: newBranchId,
          branchMappingLogic: `hash_lt(mappingId, ${thresholdBelow.toFixed(10)})`,
        },
        { branchId: oldBranchId, branchMappingLogic: "true" },
      ],
      salt: testSalt,
    });
    const resultBelow = await evaluateBranchMapping(mappingBelow, testClientId);
    expect(resultBelow).toBe(oldBranchId);
  });
});
