import {
  buildBranchMapping,
  evaluateBranchMapping,
  extractNewBranchId,
  updateBranchMappingPercentage,
} from "./branch-mapping";

describe("branch-mapping", () => {
  const newBranchId = "new-branch-1";
  const oldBranchId = "old-branch-1";
  const salt = "test-salt-uuid";

  describe(buildBranchMapping, () => {
    test("produces correct JSON structure", () => {
      const json = buildBranchMapping({
        newBranchId,
        oldBranchId,
        percentage: 10,
        salt,
      });
      const parsed = JSON.parse(json);

      expect(parsed).toEqual({
        data: [
          { branchId: newBranchId, branchMappingLogic: "hash_lt(mappingId, 0.10)" },
          { branchId: oldBranchId, branchMappingLogic: "true" },
        ],
        salt,
      });
    });

    test("formats percentage as two-decimal threshold", () => {
      const json = buildBranchMapping({
        newBranchId,
        oldBranchId,
        percentage: 50,
        salt,
      });
      const parsed = JSON.parse(json);
      expect(parsed.data[0].branchMappingLogic).toBe("hash_lt(mappingId, 0.50)");
    });

    test("handles 100% percentage", () => {
      const json = buildBranchMapping({
        newBranchId,
        oldBranchId,
        percentage: 100,
        salt,
      });
      const parsed = JSON.parse(json);
      expect(parsed.data[0].branchMappingLogic).toBe("hash_lt(mappingId, 1.00)");
    });
  });

  describe(updateBranchMappingPercentage, () => {
    test("updates threshold correctly", () => {
      const original = buildBranchMapping({
        newBranchId,
        oldBranchId,
        percentage: 10,
        salt,
      });
      const updated = updateBranchMappingPercentage(original, 50);
      const parsed = JSON.parse(updated);

      expect(parsed.data[0].branchMappingLogic).toBe("hash_lt(mappingId, 0.50)");
      // Other fields remain unchanged
      expect(parsed.data[0].branchId).toBe(newBranchId);
      expect(parsed.data[1].branchId).toBe(oldBranchId);
      expect(parsed.data[1].branchMappingLogic).toBe("true");
      expect(parsed.salt).toBe(salt);
    });
  });

  describe(extractNewBranchId, () => {
    test("returns first entry branchId", () => {
      const json = buildBranchMapping({
        newBranchId,
        oldBranchId,
        percentage: 10,
        salt,
      });
      expect(extractNewBranchId(json)).toBe(newBranchId);
    });
  });

  describe(evaluateBranchMapping, () => {
    const mapping = buildBranchMapping({
      newBranchId,
      oldBranchId,
      percentage: 50,
      salt,
    });

    test("returns fallback when no clientId", async () => {
      const result = await evaluateBranchMapping(mapping, undefined);
      expect(result).toBe(oldBranchId);
    });

    test("returns deterministic result for same salt + clientId", async () => {
      const result1 = await evaluateBranchMapping(mapping, "client-123");
      const result2 = await evaluateBranchMapping(mapping, "client-123");
      expect(result1).toBe(result2);
    });

    test("returns one of the two branch IDs", async () => {
      const result = await evaluateBranchMapping(mapping, "client-abc");
      expect([newBranchId, oldBranchId]).toContain(result);
    });

    test("with 100% rollout always returns new branch", async () => {
      const fullRollout = buildBranchMapping({
        newBranchId,
        oldBranchId,
        percentage: 100,
        salt,
      });
      const result = await evaluateBranchMapping(fullRollout, "any-client");
      expect(result).toBe(newBranchId);
    });
  });
});
