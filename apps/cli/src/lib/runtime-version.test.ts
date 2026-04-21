import { CommandExecutor } from "@effect/platform";
import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { RuntimeVersionError } from "./exit-codes";
import { resolveRuntimeVersion } from "./runtime-version";
import { failureError } from "./test-utils";

// ── helpers ───────────────────────────────────────────────────────

const makeStubExecutor = (stdout: string): CommandExecutor.CommandExecutor =>
  ({
    [CommandExecutor.TypeId]: CommandExecutor.TypeId,
    string: () => Effect.succeed(stdout),
  }) as unknown as CommandExecutor.CommandExecutor;

const provideStubExecutor = (stdout: string) =>
  Effect.provideService(CommandExecutor.CommandExecutor, makeStubExecutor(stdout));

// ── tests ─────────────────────────────────────────────────────────

describe(resolveRuntimeVersion, () => {
  it.effect("returns literal string as-is", () =>
    Effect.gen(function* () {
      const result = yield* resolveRuntimeVersion({
        raw: "1.2.3",
        appVersion: "9.9.9",
        projectRoot: ".",
      }).pipe(provideStubExecutor(""));
      expect(result).toBe("1.2.3");
    }),
  );

  it.effect('resolves {policy:"appVersion"} to appVersion', () =>
    Effect.gen(function* () {
      const result = yield* resolveRuntimeVersion({
        raw: { policy: "appVersion" },
        appVersion: "2.5.0",
        projectRoot: ".",
      }).pipe(provideStubExecutor(""));
      expect(result).toBe("2.5.0");
    }),
  );

  it.effect('fails when policy "appVersion" has no expo.version', () =>
    Effect.gen(function* () {
      const exit = yield* resolveRuntimeVersion({
        raw: { policy: "appVersion" },
        appVersion: undefined,
        projectRoot: ".",
      }).pipe(provideStubExecutor(""), Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect('resolves {policy:"fingerprint"} via CommandExecutor JSON hash', () =>
    Effect.gen(function* () {
      const result = yield* resolveRuntimeVersion({
        raw: { policy: "fingerprint" },
        appVersion: undefined,
        projectRoot: ".",
      }).pipe(provideStubExecutor('{"hash":"abc123","sources":[]}'));
      expect(result).toBe("abc123");
    }),
  );

  it.effect("fails when fingerprint stdout is not JSON", () =>
    Effect.gen(function* () {
      const exit = yield* resolveRuntimeVersion({
        raw: { policy: "fingerprint" },
        appVersion: undefined,
        projectRoot: ".",
      }).pipe(provideStubExecutor("not-json"), Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(RuntimeVersionError);
      }
    }),
  );

  it.effect("fails when fingerprint JSON has no hash field", () =>
    Effect.gen(function* () {
      const exit = yield* resolveRuntimeVersion({
        raw: { policy: "fingerprint" },
        appVersion: undefined,
        projectRoot: ".",
      }).pipe(provideStubExecutor('{"sources":[]}'), Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect('fails with guidance on policy "nativeVersion"', () =>
    Effect.gen(function* () {
      const exit = yield* resolveRuntimeVersion({
        raw: { policy: "nativeVersion" },
        appVersion: undefined,
        projectRoot: ".",
      }).pipe(provideStubExecutor(""), Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(RuntimeVersionError);
        expect(error!.message).toContain("nativeVersion");
      }
    }),
  );

  it.effect("fails when runtimeVersion is missing entirely", () =>
    Effect.gen(function* () {
      const exit = yield* resolveRuntimeVersion({
        raw: undefined,
        appVersion: "1.0.0",
        projectRoot: ".",
      }).pipe(provideStubExecutor(""), Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );
});
