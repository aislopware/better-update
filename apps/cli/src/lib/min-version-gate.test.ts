import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { MinVersionCheck } from "../services/min-version-check";
import { enforceMinVersion } from "./min-version-gate";

const makeLayer = (requireAbove: string | undefined) =>
  Layer.succeed(MinVersionCheck, {
    requireVersionAbove: Effect.succeed(requireAbove),
  });

const run = async (current: string, requireAbove: string | undefined): Promise<boolean> =>
  Effect.runPromise(
    enforceMinVersion(current, "file:///x").pipe(Effect.provide(makeLayer(requireAbove))),
  );

describe(enforceMinVersion, () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it.effect("blocks + prints when the current version is older than the threshold", () =>
    Effect.gen(function* () {
      const blocked = yield* Effect.promise(async () => run("1.0.0", "1.2.0"));
      expect(blocked).toBe(true);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain("Unsupported version");
    }),
  );

  it.effect("blocks when the current version EQUALS the threshold (strict >)", () =>
    Effect.gen(function* () {
      const blocked = yield* Effect.promise(async () => run("1.2.0", "1.2.0"));
      expect(blocked).toBe(true);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect("allows silently when the current version is strictly newer than the threshold", () =>
    Effect.gen(function* () {
      const blocked = yield* Effect.promise(async () => run("1.2.1", "1.2.0"));
      expect(blocked).toBe(false);
      expect(errorSpy).not.toHaveBeenCalled();
    }),
  );

  it.effect("fails open (allows) when the threshold cannot be resolved", () =>
    Effect.gen(function* () {
      const blocked = yield* Effect.promise(async () => run("1.0.0", undefined));
      expect(blocked).toBe(false);
      expect(errorSpy).not.toHaveBeenCalled();
    }),
  );
});
