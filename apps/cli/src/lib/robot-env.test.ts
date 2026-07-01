import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { parseRobotEnv, serializeRobotEnv } from "./robot-env";
import { failureError } from "./test-utils";

describe("robot-env codec", () => {
  it.effect("round-trips both halves", () =>
    Effect.gen(function* () {
      const serialized = serializeRobotEnv({
        bearer: "bu_robot_abc123",
        identity: "AGE-SECRET-KEY-1EXAMPLE",
      });
      const parsed = yield* parseRobotEnv(serialized);
      expect(parsed).toStrictEqual({
        bearer: "bu_robot_abc123",
        identity: "AGE-SECRET-KEY-1EXAMPLE",
      });
    }),
  );

  it.effect("round-trips a vault-only bundle (no bearer yet)", () =>
    Effect.gen(function* () {
      const serialized = serializeRobotEnv({ bearer: null, identity: "AGE-SECRET-KEY-1EXAMPLE" });
      const parsed = yield* parseRobotEnv(serialized);
      expect(parsed.bearer).toBeNull();
      expect(parsed.identity).toBe("AGE-SECRET-KEY-1EXAMPLE");
    }),
  );

  it.effect("rejects malformed base64", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(parseRobotEnv("not-valid-base64!!!"));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(failureError(exit)?.message).toContain("not a valid robot account credential");
    }),
  );

  it.effect("rejects a well-formed but wrong-version payload", () =>
    Effect.gen(function* () {
      const badVersion = Buffer.from(
        JSON.stringify({ version: 99, bearer: "x", identity: "y" }),
      ).toString("base64url");
      const exit = yield* Effect.exit(parseRobotEnv(badVersion));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(failureError(exit)?.message).toContain("not a valid robot account credential");
    }),
  );
});
