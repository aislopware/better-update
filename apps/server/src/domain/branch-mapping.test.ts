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

// Mirror CryptoService.sha256Fraction(salt, clientId) so tests can pick a
// threshold just above / below a client's deterministic bucket fraction.
const sha256Fraction = (salt: string, clientId: string): Effect.Effect<number> =>
  Effect.promise(async () => {
    const input = new TextEncoder().encode(`${salt}:${clientId}`);
    const hashBuffer = await crypto.subtle.digest("SHA-256", input);
    const view = new DataView(hashBuffer);
    return view.getUint32(0, false) / 4_294_967_296;
  });

const node = (branchId: string, branchMappingLogic: unknown) => ({ branchId, branchMappingLogic });

const mappingJson = (data: unknown[], salt = "salt") => JSON.stringify({ data, salt });

describe(buildBranchMapping, () => {
  it("emits canonical object node + 'true' fallback + salt (unconstrained)", () => {
    const result = buildBranchMapping({
      newBranchId: "new-branch-1",
      oldBranchId: "old-branch-1",
      percentage: 25,
      salt: "salt-uuid",
    });

    const parsed = JSON.parse(result);
    expect(parsed.data).toHaveLength(2);
    expect(parsed.data[0].branchId).toBe("new-branch-1");
    expect(parsed.data[0].branchMappingLogic).toStrictEqual({
      clientKey: "rolloutToken",
      branchMappingOperator: "hash_lt",
      operand: 0.25,
    });
    expect(parsed.data[1].branchId).toBe("old-branch-1");
    expect(parsed.data[1].branchMappingLogic).toBe("true");
    expect(parsed.salt).toBe("salt-uuid");
  });

  it("formats the operand at 2-decimal precision", () => {
    const parsed = JSON.parse(
      buildBranchMapping({ newBranchId: "new", oldBranchId: "old", percentage: 10, salt: "s" }),
    );
    expect(parsed.data[0].branchMappingLogic.operand).toBe(0.1);
  });

  it("handles 100% rollout (operand 1)", () => {
    const parsed = JSON.parse(
      buildBranchMapping({ newBranchId: "new", oldBranchId: "old", percentage: 100, salt: "s" }),
    );
    expect(parsed.data[0].branchMappingLogic.operand).toBe(1);
  });

  it("emits an RTV-constrained 'and' node when runtimeVersion is given", () => {
    const parsed = JSON.parse(
      buildBranchMapping({
        newBranchId: "new",
        oldBranchId: "old",
        percentage: 30,
        salt: "s",
        runtimeVersion: "1.2.3",
      }),
    );
    expect(parsed.data[0].branchMappingLogic).toStrictEqual([
      "and",
      { clientKey: "runtimeVersion", branchMappingOperator: "==", operand: "1.2.3" },
      { clientKey: "rolloutToken", branchMappingOperator: "hash_lt", operand: 0.3 },
    ]);
    expect(parsed.data[1].branchMappingLogic).toBe("true");
  });
});

describe(updateBranchMappingPercentage, () => {
  it("updates the bare hash_lt operand and preserves salt + fallback", () => {
    const original = buildBranchMapping({
      newBranchId: "new-1",
      oldBranchId: "old-1",
      percentage: 10,
      salt: "my-salt",
    });

    const parsed = JSON.parse(updateBranchMappingPercentage(original, 50));

    expect(parsed.data[0].branchMappingLogic).toStrictEqual({
      clientKey: "rolloutToken",
      branchMappingOperator: "hash_lt",
      operand: 0.5,
    });
    expect(parsed.data[0].branchId).toBe("new-1");
    expect(parsed.data[1].branchId).toBe("old-1");
    expect(parsed.data[1].branchMappingLogic).toBe("true");
    expect(parsed.salt).toBe("my-salt");
  });

  it("on an RTV-constrained mapping changes ONLY the hash operand, keeping the runtimeVersion node", () => {
    const original = buildBranchMapping({
      newBranchId: "new-1",
      oldBranchId: "old-1",
      percentage: 10,
      salt: "s",
      runtimeVersion: "2.0.0",
    });

    const parsed = JSON.parse(updateBranchMappingPercentage(original, 75));

    expect(parsed.data[0].branchMappingLogic).toStrictEqual([
      "and",
      { clientKey: "runtimeVersion", branchMappingOperator: "==", operand: "2.0.0" },
      { clientKey: "rolloutToken", branchMappingOperator: "hash_lt", operand: 0.75 },
    ]);
  });

  it("updates a legacy hash_lt string first entry", () => {
    const original = mappingJson(
      [node("new", "hash_lt(mappingId, 0.10)"), node("old", "true")],
      "s",
    );
    const parsed = JSON.parse(updateBranchMappingPercentage(original, 60));
    expect(parsed.data[0].branchMappingLogic).toStrictEqual({
      clientKey: "rolloutToken",
      branchMappingOperator: "hash_lt",
      operand: 0.6,
    });
  });
});

describe(extractNewBranchId, () => {
  it("returns first entry branchId for the object-node shape", () => {
    const mapping = buildBranchMapping({
      newBranchId: "target-branch",
      oldBranchId: "fallback-branch",
      percentage: 30,
      salt: "s",
    });
    expect(extractNewBranchId(mapping)).toBe("target-branch");
  });

  it("returns first entry branchId for the RTV-constrained shape", () => {
    const mapping = buildBranchMapping({
      newBranchId: "target-branch",
      oldBranchId: "fallback-branch",
      percentage: 30,
      salt: "s",
      runtimeVersion: "1.0.0",
    });
    expect(extractNewBranchId(mapping)).toBe("target-branch");
  });
});

describe(extractReachableBranchIds, () => {
  it("returns both rollout target and fallback branch ids", () => {
    const mapping = buildBranchMapping({
      newBranchId: "branch-new",
      oldBranchId: "branch-old",
      percentage: 50,
      salt: "salt",
    });
    expect(extractReachableBranchIds(mapping)).toStrictEqual(["branch-new", "branch-old"]);
  });

  it("INCLUDES a 0%-threshold entry (superset / over-count is safe) and dedupes", () => {
    const mapping = mappingJson([
      node("branch-zero", "hash_lt(mappingId, 0.00)"),
      node("branch-valid", "hash_lt(mappingId, 0.25)"),
      node("branch-valid", "true"),
      // An unsupported legacy string in a NON-last entry is excluded; a 'true'
      // last entry below keeps it from being the always-included fallback.
      node("branch-invalid", "unsupported(mappingId, 0.5)"),
      node("branch-default", "true"),
    ]);
    // branch-zero is now reachable (was skipped before); branch-valid deduped;
    // unsupported legacy string still excluded; explicit 'true' default kept.
    expect(extractReachableBranchIds(mapping)).toStrictEqual([
      "branch-zero",
      "branch-valid",
      "branch-default",
    ]);
  });

  it("includes branchIds whose logic is a nested and/or/not statement", () => {
    const mapping = mappingJson([
      node("branch-and", [
        "and",
        { clientKey: "runtimeVersion", branchMappingOperator: "==", operand: "1.0.0" },
        { clientKey: "rolloutToken", branchMappingOperator: "hash_lt", operand: 0.5 },
      ]),
      node("branch-or", [
        "or",
        { clientKey: "cohort", branchMappingOperator: "==", operand: "beta" },
        { clientKey: "cohort", branchMappingOperator: "==", operand: "alpha" },
      ]),
      node("branch-not", [
        "not",
        { clientKey: "runtimeVersion", branchMappingOperator: "==", operand: "9.9.9" },
      ]),
    ]);
    expect(extractReachableBranchIds(mapping)).toStrictEqual([
      "branch-and",
      "branch-or",
      "branch-not",
    ]);
  });

  it("excludes a structurally invalid NON-last node entry", () => {
    const mapping = mappingJson([
      node("branch-ok", "true"),
      node("branch-bad", { clientKey: "x", branchMappingOperator: "nope", operand: 1 }),
      node("branch-last", "true"),
    ]);
    expect(extractReachableBranchIds(mapping)).toStrictEqual(["branch-ok", "branch-last"]);
  });

  // Superset invariant: the evaluator's unconditional fallback ALWAYS routes to
  // the last entry's branchId even when its logic is un-normalizable, so the
  // reachable set must include it (under-counting would let the reaper delete a
  // still-routable branch's updates).
  it("ALWAYS includes the last entry's branchId even when its logic is un-normalizable", () => {
    const mapping = mappingJson([
      node("branch-A", "hash_lt(mappingId, 0.50)"),
      node("branch-FALLBACK", "legacy_unsupported(x)"),
    ]);
    expect(extractReachableBranchIds(mapping)).toStrictEqual(["branch-A", "branch-FALLBACK"]);
  });

  it("returns empty array for valid JSON with wrong shape", () => {
    expect(extractReachableBranchIds(JSON.stringify({ nope: true }))).toStrictEqual([]);
  });
});

describe(evaluateBranchMapping, () => {
  const newBranchId = "branch-new";
  const oldBranchId = "branch-old";
  const salt = "test-salt-uuid";

  // -- backward-compat: legacy hash_lt string ------------------------------

  it.effect("returns fallback branch when no clientId is provided", () =>
    Effect.gen(function* () {
      const mapping = buildBranchMapping({ newBranchId, oldBranchId, percentage: 50, salt });
      const result = yield* evaluateBranchMapping(mapping, {});
      expect(result).toBe(oldBranchId);
    }).pipe(withCrypto),
  );

  it.effect("is deterministic for same salt + clientId", () =>
    Effect.gen(function* () {
      const mapping = buildBranchMapping({ newBranchId, oldBranchId, percentage: 50, salt });
      const ctx = { easClientId: "client-abc-123" };
      const r1 = yield* evaluateBranchMapping(mapping, ctx);
      const r2 = yield* evaluateBranchMapping(mapping, ctx);
      const r3 = yield* evaluateBranchMapping(mapping, ctx);
      expect(r1).toBe(r2);
      expect(r2).toBe(r3);
    }).pipe(withCrypto),
  );

  it.effect("at 100% all clients get the new branch", () =>
    Effect.gen(function* () {
      const mapping = buildBranchMapping({ newBranchId, oldBranchId, percentage: 100, salt });
      const clientIds = ["client-1", "client-2", "client-3", "client-4", "client-5"];
      const results = yield* Effect.all(
        clientIds.map((clientId) => evaluateBranchMapping(mapping, { easClientId: clientId })),
      );
      results.forEach((result) => expect(result).toBe(newBranchId));
    }).pipe(withCrypto),
  );

  it.effect("at 0% (legacy string) no clients get the new branch", () =>
    Effect.gen(function* () {
      const mapping = mappingJson(
        [node(newBranchId, "hash_lt(mappingId, 0.00)"), node(oldBranchId, "true")],
        salt,
      );
      const clientIds = ["client-1", "client-2", "client-3", "client-4", "client-5"];
      const results = yield* Effect.all(
        clientIds.map((clientId) => evaluateBranchMapping(mapping, { easClientId: clientId })),
      );
      results.forEach((result) => expect(result).toBe(oldBranchId));
    }).pipe(withCrypto),
  );

  it.effect("skips entries with unrecognized legacy branchMappingLogic", () =>
    Effect.gen(function* () {
      const mapping = mappingJson(
        [node(newBranchId, "unknown_operator(foo, 0.50)"), node(oldBranchId, "true")],
        salt,
      );
      const result = yield* evaluateBranchMapping(mapping, { easClientId: "any-client" });
      expect(result).toBe(oldBranchId);
    }).pipe(withCrypto),
  );

  // Superset-invariant pin: when no earlier entry matches and the LAST entry's
  // logic is un-normalizable, the evaluator still routes to it (unconditional
  // anti-brick fallback) — and extractReachableBranchIds must include it, so the
  // two stay in lock-step. Here a non-bucketed client (hash_lt 0.00 never hits)
  // routes to the malformed-logic last branch.
  it.effect(
    "routes to the last entry even when its logic is un-normalizable (matches reachable set)",
    () =>
      Effect.gen(function* () {
        const mapping = mappingJson(
          [
            node("branch-A", "hash_lt(mappingId, 0.00)"),
            node("branch-FALLBACK", "legacy_unsupported(x)"),
          ],
          salt,
        );
        const result = yield* evaluateBranchMapping(mapping, { easClientId: "any-client" });
        expect(result).toBe("branch-FALLBACK");
        expect(extractReachableBranchIds(mapping)).toContain(result);
      }).pipe(withCrypto),
  );

  it.effect("returns null fallback for valid JSON with wrong shape", () =>
    Effect.gen(function* () {
      const result = yield* evaluateBranchMapping(JSON.stringify({ notData: true }), {
        easClientId: "any-client",
      });
      expect(result).toBeNull();
    }).pipe(withCrypto),
  );

  it.effect("returns null fallback for malformed JSON", () =>
    Effect.gen(function* () {
      const result = yield* evaluateBranchMapping("not-json", { easClientId: "any-client" });
      expect(result).toBeNull();
    }).pipe(withCrypto),
  );

  // -- 'true' constant node -------------------------------------------------

  it.effect("'true' constant always matches", () =>
    Effect.gen(function* () {
      const mapping = mappingJson([node("always", "true"), node("never", "true")], salt);
      const result = yield* evaluateBranchMapping(mapping, {});
      expect(result).toBe("always");
    }).pipe(withCrypto),
  );

  // -- rolloutToken hash leaf truth table -----------------------------------

  it.effect("rolloutToken hash_lt / hash_lte / hash_gt / hash_gte vs known fraction", () =>
    Effect.gen(function* () {
      const testSalt = "known-salt";
      const clientId = "known-client";
      const fraction = yield* sha256Fraction(testSalt, clientId);
      const above = Math.min(fraction + 0.01, 1);
      const below = Math.max(fraction - 0.01, 0);

      const leaf = (operator: string, operand: number) =>
        mappingJson(
          [
            node("hit", { clientKey: "rolloutToken", branchMappingOperator: operator, operand }),
            node("miss", "true"),
          ],
          testSalt,
        );

      // hash_lt: fraction < operand
      expect(yield* evaluateBranchMapping(leaf("hash_lt", above), { easClientId: clientId })).toBe(
        "hit",
      );
      expect(yield* evaluateBranchMapping(leaf("hash_lt", below), { easClientId: clientId })).toBe(
        "miss",
      );
      // hash_lte at exactly fraction
      expect(
        yield* evaluateBranchMapping(leaf("hash_lte", fraction), { easClientId: clientId }),
      ).toBe("hit");
      // hash_gt: fraction > operand
      expect(yield* evaluateBranchMapping(leaf("hash_gt", below), { easClientId: clientId })).toBe(
        "hit",
      );
      expect(yield* evaluateBranchMapping(leaf("hash_gt", above), { easClientId: clientId })).toBe(
        "miss",
      );
      // hash_gte at exactly fraction
      expect(
        yield* evaluateBranchMapping(leaf("hash_gte", fraction), { easClientId: clientId }),
      ).toBe("hit");
    }).pipe(withCrypto),
  );

  it.effect("rolloutToken leaf is FALSE when no easClientId (token undefined)", () =>
    Effect.gen(function* () {
      const mapping = mappingJson(
        [
          node("hit", { clientKey: "rolloutToken", branchMappingOperator: "hash_lt", operand: 1 }),
          node("miss", "true"),
        ],
        salt,
      );
      const result = yield* evaluateBranchMapping(mapping, {});
      expect(result).toBe("miss");
    }).pipe(withCrypto),
  );

  // -- runtimeVersion leaf --------------------------------------------------

  it.effect("runtimeVersion == / != / in", () =>
    Effect.gen(function* () {
      const eq = mappingJson([
        node("hit", { clientKey: "runtimeVersion", branchMappingOperator: "==", operand: "1.0.0" }),
        node("miss", "true"),
      ]);
      expect(yield* evaluateBranchMapping(eq, { runtimeVersion: "1.0.0" })).toBe("hit");
      expect(yield* evaluateBranchMapping(eq, { runtimeVersion: "2.0.0" })).toBe("miss");

      const ne = mappingJson([
        node("hit", { clientKey: "runtimeVersion", branchMappingOperator: "!=", operand: "1.0.0" }),
        node("miss", "true"),
      ]);
      expect(yield* evaluateBranchMapping(ne, { runtimeVersion: "2.0.0" })).toBe("hit");
      expect(yield* evaluateBranchMapping(ne, { runtimeVersion: "1.0.0" })).toBe("miss");

      const inList = mappingJson([
        node("hit", {
          clientKey: "runtimeVersion",
          branchMappingOperator: "in",
          operand: ["1.0.0", "1.1.0"],
        }),
        node("miss", "true"),
      ]);
      expect(yield* evaluateBranchMapping(inList, { runtimeVersion: "1.1.0" })).toBe("hit");
      expect(yield* evaluateBranchMapping(inList, { runtimeVersion: "3.0.0" })).toBe("miss");
    }).pipe(withCrypto),
  );

  // -- extra-param leaf -----------------------------------------------------

  it.effect("extra-param == / != / in / regex", () =>
    Effect.gen(function* () {
      const eq = mappingJson([
        node("hit", { clientKey: "cohort", branchMappingOperator: "==", operand: "beta" }),
        node("miss", "true"),
      ]);
      expect(yield* evaluateBranchMapping(eq, { extraParams: { cohort: "beta" } })).toBe("hit");
      expect(yield* evaluateBranchMapping(eq, { extraParams: { cohort: "ga" } })).toBe("miss");
      // missing key -> == against undefined never matches
      expect(yield* evaluateBranchMapping(eq, { extraParams: {} })).toBe("miss");

      const ne = mappingJson([
        node("hit", { clientKey: "cohort", branchMappingOperator: "!=", operand: "beta" }),
        node("miss", "true"),
      ]);
      // missing key -> != true
      expect(yield* evaluateBranchMapping(ne, { extraParams: {} })).toBe("hit");

      const inList = mappingJson([
        node("hit", {
          clientKey: "cohort",
          branchMappingOperator: "in",
          operand: ["beta", "alpha"],
        }),
        node("miss", "true"),
      ]);
      expect(yield* evaluateBranchMapping(inList, { extraParams: { cohort: "alpha" } })).toBe(
        "hit",
      );
      expect(yield* evaluateBranchMapping(inList, { extraParams: {} })).toBe("miss");

      const re = mappingJson([
        node("hit", { clientKey: "cohort", branchMappingOperator: "regex", operand: "^be.a$" }),
        node("miss", "true"),
      ]);
      expect(yield* evaluateBranchMapping(re, { extraParams: { cohort: "beta" } })).toBe("hit");
      expect(yield* evaluateBranchMapping(re, { extraParams: { cohort: "gamma" } })).toBe("miss");
      // regex against a missing key -> false
      expect(yield* evaluateBranchMapping(re, { extraParams: {} })).toBe("miss");
    }).pipe(withCrypto),
  );

  // -- boolean composition --------------------------------------------------

  it.effect("['and', rtv==X, hash_lt 1] — 4-cell rtv x in-bucket truth table", () =>
    Effect.gen(function* () {
      const mapping = mappingJson(
        [
          node("hit", [
            "and",
            { clientKey: "runtimeVersion", branchMappingOperator: "==", operand: "1.0.0" },
            { clientKey: "rolloutToken", branchMappingOperator: "hash_lt", operand: 1 },
          ]),
          node("miss", "true"),
        ],
        salt,
      );
      // rtv match + in bucket (100%) -> hit
      expect(
        yield* evaluateBranchMapping(mapping, { easClientId: "c", runtimeVersion: "1.0.0" }),
      ).toBe("hit");
      // rtv mismatch -> miss (regardless of bucket)
      expect(
        yield* evaluateBranchMapping(mapping, { easClientId: "c", runtimeVersion: "2.0.0" }),
      ).toBe("miss");
      // rtv match but no clientId -> hash leaf false -> miss
      expect(yield* evaluateBranchMapping(mapping, { runtimeVersion: "1.0.0" })).toBe("miss");
    }).pipe(withCrypto),
  );

  it.effect("['or', a, b] matches when either child is true", () =>
    Effect.gen(function* () {
      const mapping = mappingJson([
        node("hit", [
          "or",
          { clientKey: "cohort", branchMappingOperator: "==", operand: "beta" },
          { clientKey: "runtimeVersion", branchMappingOperator: "==", operand: "1.0.0" },
        ]),
        node("miss", "true"),
      ]);
      expect(
        yield* evaluateBranchMapping(mapping, { runtimeVersion: "1.0.0", extraParams: {} }),
      ).toBe("hit");
      expect(yield* evaluateBranchMapping(mapping, { extraParams: { cohort: "beta" } })).toBe(
        "hit",
      );
      expect(
        yield* evaluateBranchMapping(mapping, { runtimeVersion: "9.9.9", extraParams: {} }),
      ).toBe("miss");
    }).pipe(withCrypto),
  );

  it.effect("['not', n] negation", () =>
    Effect.gen(function* () {
      const mapping = mappingJson([
        node("hit", [
          "not",
          { clientKey: "runtimeVersion", branchMappingOperator: "==", operand: "1.0.0" },
        ]),
        node("miss", "true"),
      ]);
      expect(yield* evaluateBranchMapping(mapping, { runtimeVersion: "2.0.0" })).toBe("hit");
      expect(yield* evaluateBranchMapping(mapping, { runtimeVersion: "1.0.0" })).toBe("miss");
    }).pipe(withCrypto),
  );

  it.effect("nested ['and', ['or',...], ['not',...]] sanity", () =>
    Effect.gen(function* () {
      const mapping = mappingJson([
        node("hit", [
          "and",
          [
            "or",
            { clientKey: "cohort", branchMappingOperator: "==", operand: "beta" },
            { clientKey: "cohort", branchMappingOperator: "==", operand: "alpha" },
          ],
          ["not", { clientKey: "runtimeVersion", branchMappingOperator: "==", operand: "9.9.9" }],
        ]),
        node("miss", "true"),
      ]);
      expect(
        yield* evaluateBranchMapping(mapping, {
          runtimeVersion: "1.0.0",
          extraParams: { cohort: "alpha" },
        }),
      ).toBe("hit");
      // fails the 'or' -> miss
      expect(
        yield* evaluateBranchMapping(mapping, {
          runtimeVersion: "1.0.0",
          extraParams: { cohort: "ga" },
        }),
      ).toBe("miss");
      // fails the 'not' -> miss
      expect(
        yield* evaluateBranchMapping(mapping, {
          runtimeVersion: "9.9.9",
          extraParams: { cohort: "alpha" },
        }),
      ).toBe("miss");
    }).pipe(withCrypto),
  );

  // -- RTV-gated mapping end-to-end -----------------------------------------

  it.effect(
    "RTV-gated rollout: matching RTV in bucket -> rollout branch; other RTV -> default",
    () =>
      Effect.gen(function* () {
        const mapping = buildBranchMapping({
          newBranchId,
          oldBranchId,
          percentage: 100,
          salt,
          runtimeVersion: "1.0.0",
        });
        const ctxA = { easClientId: "client-x", runtimeVersion: "1.0.0" };
        const ctxB = { easClientId: "client-x", runtimeVersion: "2.0.0" };
        expect(yield* evaluateBranchMapping(mapping, ctxA)).toBe(newBranchId);
        expect(yield* evaluateBranchMapping(mapping, ctxB)).toBe(oldBranchId);
        // deterministic across repeats
        expect(yield* evaluateBranchMapping(mapping, ctxA)).toBe(newBranchId);
        expect(yield* evaluateBranchMapping(mapping, ctxB)).toBe(oldBranchId);
      }).pipe(withCrypto),
  );

  // -- ReDoS operand rejection ----------------------------------------------

  it.effect("over-length regex operand -> leaf evaluates false", () =>
    Effect.gen(function* () {
      const longPattern = "a".repeat(300);
      const mapping = mappingJson([
        node("hit", { clientKey: "cohort", branchMappingOperator: "regex", operand: longPattern }),
        node("miss", "true"),
      ]);
      const result = yield* evaluateBranchMapping(mapping, {
        extraParams: { cohort: "a".repeat(300) },
      });
      expect(result).toBe("miss");
    }).pipe(withCrypto),
  );

  it.effect("catastrophic-backtracking pattern is bounded (returns, never hangs)", () =>
    Effect.gen(function* () {
      const mapping = mappingJson([
        node("hit", { clientKey: "cohort", branchMappingOperator: "regex", operand: "(a+)+$" }),
        node("miss", "true"),
      ]);
      // A non-matching adversarial input would backtrack catastrophically on an
      // unbounded engine; here the input is length-bounded so it returns promptly.
      const result = yield* evaluateBranchMapping(mapping, {
        extraParams: { cohort: `${"a".repeat(40)}!` },
      });
      // It still produces a deterministic boolean result (a definite no-match here).
      expect(result).toBe("miss");
    }).pipe(withCrypto),
  );

  // Alternation-overlap backtracking is just as catastrophic as the nested
  // quantifier shape and a far more common form: `(a|a|a)*c` against ~22 'a'
  // chars pins a JS isolate for ~112s. The static-shape heuristic must reject
  // these promptly (degrade to no-match == "miss"), not let them run.
  it.effect(
    "alternation-under-quantifier ReDoS patterns are rejected (route to miss promptly)",
    () =>
      Effect.gen(function* () {
        const adversarial = ["(a|a)*", "(a|ab)*", "(a|a|a)*c", "(.|.)*x", "((a+))+"];
        const results = yield* Effect.all(
          adversarial.map((operand) =>
            evaluateBranchMapping(
              mappingJson([
                node("hit", { clientKey: "cohort", branchMappingOperator: "regex", operand }),
                node("miss", "true"),
              ]),
              // An input that would trigger catastrophic backtracking on an
              // unbounded engine — must return promptly because the pattern is
              // rejected before RegExp.test ever runs.
              { extraParams: { cohort: "a".repeat(30) } },
            ),
          ),
        );
        results.forEach((result) => expect(result).toBe("miss"));
      }).pipe(withCrypto),
  );

  it.effect("invalid regex string -> false (no throw)", () =>
    Effect.gen(function* () {
      const mapping = mappingJson([
        node("hit", { clientKey: "cohort", branchMappingOperator: "regex", operand: "(" }),
        node("miss", "true"),
      ]);
      const result = yield* evaluateBranchMapping(mapping, { extraParams: { cohort: "x" } });
      expect(result).toBe("miss");
    }).pipe(withCrypto),
  );

  it.effect("benign regex still matches / non-matches correctly", () =>
    Effect.gen(function* () {
      const mapping = mappingJson([
        node("hit", { clientKey: "cohort", branchMappingOperator: "regex", operand: "^v[0-9]+$" }),
        node("miss", "true"),
      ]);
      expect(yield* evaluateBranchMapping(mapping, { extraParams: { cohort: "v42" } })).toBe("hit");
      expect(yield* evaluateBranchMapping(mapping, { extraParams: { cohort: "x" } })).toBe("miss");
    }).pipe(withCrypto),
  );

  // -- mixed legacy-string + object-node table routes correctly -------------

  it.effect("mixed legacy string + object-node entries route by first match", () =>
    Effect.gen(function* () {
      const mapping = mappingJson(
        [
          node("rtv-branch", {
            clientKey: "runtimeVersion",
            branchMappingOperator: "==",
            operand: "1.0.0",
          }),
          node("legacy-100", "hash_lt(mappingId, 1.00)"),
          node("fallback", "true"),
        ],
        salt,
      );
      // RTV match -> first entry wins
      expect(
        yield* evaluateBranchMapping(mapping, { easClientId: "c", runtimeVersion: "1.0.0" }),
      ).toBe("rtv-branch");
      // RTV mismatch -> legacy 100% entry wins (any client in bucket)
      expect(
        yield* evaluateBranchMapping(mapping, { easClientId: "c", runtimeVersion: "2.0.0" }),
      ).toBe("legacy-100");
    }).pipe(withCrypto),
  );

  // hash correctness regression (kept from before, ported to the ctx signature)
  it.effect("hash correctness for known salt + clientId (legacy string)", () =>
    Effect.gen(function* () {
      const testSalt = "known-salt";
      const testClientId = "known-client";
      const expectedValue = yield* sha256Fraction(testSalt, testClientId);
      const thresholdAbove = Math.min(expectedValue + 0.01, 1);
      const thresholdBelow = Math.max(expectedValue - 0.01, 0);

      const mappingAbove = mappingJson(
        [
          node(newBranchId, `hash_lt(mappingId, ${thresholdAbove.toFixed(10)})`),
          node(oldBranchId, "true"),
        ],
        testSalt,
      );
      expect(yield* evaluateBranchMapping(mappingAbove, { easClientId: testClientId })).toBe(
        newBranchId,
      );

      const mappingBelow = mappingJson(
        [
          node(newBranchId, `hash_lt(mappingId, ${thresholdBelow.toFixed(10)})`),
          node(oldBranchId, "true"),
        ],
        testSalt,
      );
      expect(yield* evaluateBranchMapping(mappingBelow, { easClientId: testClientId })).toBe(
        oldBranchId,
      );
    }).pipe(withCrypto),
  );
});
