import { it } from "@effect/vitest";
import { Effect } from "effect";

import { CryptoServiceLive } from "../cloudflare/crypto-service";
import {
  buildBranchMapping,
  evaluateBranchMapping,
  extractNewBranchId,
  extractReachableBranchIds,
  updateBranchMappingPercentage,
} from "./branch-mapping";

const withCrypto = Effect.provide(CryptoServiceLive);

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

describe(extractReachableBranchIds, () => {
  test("returns both rollout target and fallback branch ids", () => {
    const mapping = buildBranchMapping({
      newBranchId: "branch-new",
      oldBranchId: "branch-old",
      percentage: 50,
      salt: "salt",
    });

    expect(extractReachableBranchIds(mapping)).toEqual(["branch-new", "branch-old"]);
  });

  test("skips zero-threshold and invalid entries while deduplicating branch ids", () => {
    const mapping = JSON.stringify({
      data: [
        { branchId: "branch-zero", branchMappingLogic: "hash_lt(mappingId, 0.00)" },
        { branchId: "branch-valid", branchMappingLogic: "hash_lt(mappingId, 0.25)" },
        { branchId: "branch-valid", branchMappingLogic: "true" },
        { branchId: "branch-invalid", branchMappingLogic: "unsupported(mappingId, 0.5)" },
      ],
      salt: "salt",
    });

    expect(extractReachableBranchIds(mapping)).toEqual(["branch-valid"]);
  });

  test("returns empty array for valid JSON with wrong shape", () => {
    expect(extractReachableBranchIds(JSON.stringify({ nope: true }))).toEqual([]);
  });
});

describe(evaluateBranchMapping, () => {
  const newBranchId = "branch-new";
  const oldBranchId = "branch-old";
  const salt = "test-salt-uuid";

  it.effect("returns fallback branch when no clientId is provided", () =>
    Effect.gen(function* () {
      const mapping = buildBranchMapping({ newBranchId, oldBranchId, percentage: 50, salt });
      const result = yield* evaluateBranchMapping(mapping, undefined);
      expect(result).toBe(oldBranchId);
    }).pipe(withCrypto),
  );

  it.effect("is deterministic for same salt + clientId", () =>
    Effect.gen(function* () {
      const mapping = buildBranchMapping({ newBranchId, oldBranchId, percentage: 50, salt });
      const clientId = "client-abc-123";
      const result1 = yield* evaluateBranchMapping(mapping, clientId);
      const result2 = yield* evaluateBranchMapping(mapping, clientId);
      const result3 = yield* evaluateBranchMapping(mapping, clientId);
      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    }).pipe(withCrypto),
  );

  it.effect("at 100% threshold all clients get new branch", () =>
    Effect.gen(function* () {
      const mapping = buildBranchMapping({ newBranchId, oldBranchId, percentage: 100, salt });
      const clientIds = ["client-1", "client-2", "client-3", "client-4", "client-5"];
      const results = yield* Effect.forEach(
        clientIds,
        (clientId) => evaluateBranchMapping(mapping, clientId),
        { concurrency: "unbounded" },
      );
      results.forEach((result) => expect(result).toBe(newBranchId));
    }).pipe(withCrypto),
  );

  it.effect("at 0% threshold no clients get new branch", () =>
    Effect.gen(function* () {
      const mapping = JSON.stringify({
        data: [
          { branchId: newBranchId, branchMappingLogic: "hash_lt(mappingId, 0.00)" },
          { branchId: oldBranchId, branchMappingLogic: "true" },
        ],
        salt,
      });
      const clientIds = ["client-1", "client-2", "client-3", "client-4", "client-5"];
      const results = yield* Effect.forEach(
        clientIds,
        (clientId) => evaluateBranchMapping(mapping, clientId),
        { concurrency: "unbounded" },
      );
      results.forEach((result) => expect(result).toBe(oldBranchId));
    }).pipe(withCrypto),
  );

  it.effect("skips entries with unrecognized branchMappingLogic", () =>
    Effect.gen(function* () {
      const mapping = JSON.stringify({
        data: [
          { branchId: newBranchId, branchMappingLogic: "unknown_operator(foo, 0.50)" },
          { branchId: oldBranchId, branchMappingLogic: "true" },
        ],
        salt,
      });
      const result = yield* evaluateBranchMapping(mapping, "any-client");
      expect(result).toBe(oldBranchId);
    }).pipe(withCrypto),
  );

  it.effect("returns empty fallback for valid JSON with wrong shape", () =>
    Effect.gen(function* () {
      const mapping = JSON.stringify({ notData: true });
      const result = yield* evaluateBranchMapping(mapping, "any-client");
      expect(result).toBe("");
    }).pipe(withCrypto),
  );

  it.effect("returns empty fallback for malformed JSON string", () =>
    Effect.gen(function* () {
      const result = yield* evaluateBranchMapping("not-json", "any-client");
      expect(result).toBe("");
    }).pipe(withCrypto),
  );

  it.effect("hash correctness for known salt + clientId", () =>
    Effect.gen(function* () {
      const testSalt = "known-salt";
      const testClientId = "known-client";
      const input = new TextEncoder().encode(`${testSalt}:${testClientId}`);
      const hashBuffer = yield* Effect.promise(async () => crypto.subtle.digest("SHA-256", input));
      const view = new DataView(hashBuffer);
      const uint32 = view.getUint32(0, false);
      const expectedValue = uint32 / 4_294_967_296;

      const thresholdAbove = Math.min(expectedValue + 0.01, 1);
      const thresholdBelow = Math.max(expectedValue - 0.01, 0);

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
      const resultAbove = yield* evaluateBranchMapping(mappingAbove, testClientId);
      expect(resultAbove).toBe(newBranchId);

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
      const resultBelow = yield* evaluateBranchMapping(mappingBelow, testClientId);
      expect(resultBelow).toBe(oldBranchId);
    }).pipe(withCrypto),
  );
});
