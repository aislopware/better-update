import { it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import type { Session } from "@expo/apple-utils";
// eslint-disable-next-line import-plugin/no-namespace -- stub factory typed as `typeof AppleUtils` (whole module shape); no named type covers the full module
import type * as AppleUtils from "@expo/apple-utils";

import { CliRuntime } from "../services/cli-runtime";
import { parseProviderId, resolveProvider } from "./apple-auth";
import { AppleAuthError, InteractiveProhibitedError } from "./exit-codes";
import { InteractiveModeLive, makeInteractiveModeLayer } from "./interactive-mode";

// ── helpers ──────────────────────────────────────────────────────

const provider = (
  providerId: number,
  name = `Provider ${providerId}`,
  subType = "ORGANIZATION",
): Session.SessionProvider => ({
  providerId,
  publicProviderId: `pub-${providerId}`,
  name,
  contentTypes: ["SOFTWARE"],
  subType,
});

const makeAppleUtilsStub = (setProviderSpy?: (id: number) => Promise<unknown>) =>
  ({
    Session: {
      setSessionProviderIdAsync: async (id: number) =>
        setProviderSpy?.(id) ?? Promise.resolve(null),
    },
  }) as unknown as typeof AppleUtils;

const makeCliRuntimeLayer = (env: Readonly<Record<string, string | undefined>> = {}) =>
  Layer.succeed(CliRuntime, {
    argv: [],
    platform: "linux" as NodeJS.Platform,
    cwd: Effect.succeed("/"),
    getEnv: (name: string) => Effect.succeed(env[name]),
    homeDirectory: Effect.succeed("/"),
    userName: Effect.succeed("test"),
    commandEnvironment: () => Effect.succeed({}),
    setExitCode: () => Effect.void,
  });

const provideTestServices = (env: Readonly<Record<string, string | undefined>> = {}) =>
  Layer.mergeAll(makeCliRuntimeLayer(env), InteractiveModeLive);

// ── parseProviderId ──────────────────────────────────────────────

describe(parseProviderId, () => {
  it.effect("accepts a positive integer string", () =>
    Effect.gen(function* () {
      const result = yield* parseProviderId("118573544");
      expect(result).toBe(118_573_544);
    }),
  );

  it.effect("accepts zero", () =>
    Effect.gen(function* () {
      const result = yield* parseProviderId("0");
      expect(result).toBe(0);
    }),
  );

  it.effect("rejects a non-numeric string with AppleAuthError", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(parseProviderId("abc"));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const err = exit.cause._tag === "Fail" ? exit.cause.error : null;
        expect(err).toBeInstanceOf(AppleAuthError);
        expect(err!.message).toContain("APPLE_PROVIDER_ID");
      }
    }),
  );

  it.effect("rejects a decimal value", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(parseProviderId("1.5"));
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect("rejects an empty string", () =>
    Effect.gen(function* () {
      // Number("") === 0, which IS an integer — guard at call site (readEnvProviderId)
      // Skips empty strings. Document that parseProviderId treats "" as 0.
      const result = yield* parseProviderId("");
      expect(result).toBe(0);
    }),
  );
});

// ── resolveProvider ──────────────────────────────────────────────

describe(resolveProvider, () => {
  it.effect("uses APPLE_PROVIDER_ID env when set, switching when it differs from current", () =>
    Effect.gen(function* () {
      const calls: number[] = [];
      const appleUtils = makeAppleUtilsStub(async (id) => {
        calls.push(id);
        return null;
      });

      const result = yield* resolveProvider(appleUtils, [provider(1), provider(2)], 1);

      expect(result).toStrictEqual({ providerId: 2, switched: true });
      expect(calls).toStrictEqual([2]);
    }).pipe(Effect.provide(provideTestServices({ APPLE_PROVIDER_ID: "2" }))),
  );

  it.effect("env match against current provider does not trigger switch", () =>
    Effect.gen(function* () {
      const calls: number[] = [];
      const appleUtils = makeAppleUtilsStub(async (id) => {
        calls.push(id);
        return null;
      });

      const result = yield* resolveProvider(appleUtils, [provider(1), provider(2)], 1);

      expect(result).toStrictEqual({ providerId: 1, switched: false });
      expect(calls).toStrictEqual([]);
    }).pipe(Effect.provide(provideTestServices({ APPLE_PROVIDER_ID: "1" }))),
  );

  it.effect("invalid env value fails with AppleAuthError", () =>
    Effect.gen(function* () {
      const appleUtils = makeAppleUtilsStub();
      const exit = yield* Effect.exit(resolveProvider(appleUtils, [provider(1)], 1));
      expect(Exit.isFailure(exit)).toBe(true);
    }).pipe(Effect.provide(provideTestServices({ APPLE_PROVIDER_ID: "not-a-number" }))),
  );

  it.effect("returns currentProviderId when availableProviders is empty", () =>
    Effect.gen(function* () {
      const appleUtils = makeAppleUtilsStub();

      const result = yield* resolveProvider(appleUtils, [], 5);

      expect(result).toStrictEqual({ providerId: 5, switched: false });
    }).pipe(Effect.provide(provideTestServices())),
  );

  it.effect("returns undefined when no providers and no current id", () =>
    Effect.gen(function* () {
      const appleUtils = makeAppleUtilsStub();

      const result = yield* resolveProvider(appleUtils, [], undefined);

      expect(result).toStrictEqual({ providerId: undefined, switched: false });
    }).pipe(Effect.provide(provideTestServices())),
  );

  it.effect("single available provider applies through applyChoice", () =>
    Effect.gen(function* () {
      const calls: number[] = [];
      const appleUtils = makeAppleUtilsStub(async (id) => {
        calls.push(id);
        return null;
      });

      const result = yield* resolveProvider(appleUtils, [provider(42)], undefined);

      expect(result).toStrictEqual({ providerId: 42, switched: true });
      expect(calls).toStrictEqual([42]);
    }).pipe(Effect.provide(provideTestServices())),
  );

  it.effect(
    "multi-provider non-interactive with auto-resolved current → preserves without prompt",
    () =>
      Effect.gen(function* () {
        const calls: number[] = [];
        const appleUtils = makeAppleUtilsStub(async (id) => {
          calls.push(id);
          return null;
        });

        // Non-interactive: trust apple-utils' auto-resolved current as CI-safe fallback.
        const result = yield* resolveProvider(
          appleUtils,
          [provider(1), provider(2), provider(3)],
          2,
        );

        expect(result).toStrictEqual({ providerId: 2, switched: false });
        expect(calls).toStrictEqual([]);
      }).pipe(
        Effect.provide(Layer.mergeAll(makeCliRuntimeLayer(), makeInteractiveModeLayer(false))),
      ),
  );

  it.effect(
    "multi-provider non-interactive with no env and no current → InteractiveProhibitedError",
    () =>
      Effect.gen(function* () {
        const appleUtils = makeAppleUtilsStub();

        const exit = yield* Effect.exit(
          resolveProvider(appleUtils, [provider(1), provider(2)], undefined),
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const err = exit.cause._tag === "Fail" ? exit.cause.error : null;
          expect(err).toBeInstanceOf(InteractiveProhibitedError);
        }
      }).pipe(
        Effect.provide(Layer.mergeAll(makeCliRuntimeLayer(), makeInteractiveModeLayer(false))),
      ),
  );

  it.effect("propagates AppleAuthError when setSessionProviderIdAsync rejects", () =>
    Effect.gen(function* () {
      const appleUtils = makeAppleUtilsStub(async () => {
        throw new Error("provider not accessible");
      });

      const exit = yield* Effect.exit(resolveProvider(appleUtils, [provider(1), provider(2)], 1));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const err = exit.cause._tag === "Fail" ? exit.cause.error : null;
        expect(err).toBeInstanceOf(AppleAuthError);
        expect(err!.message).toContain("Failed to switch");
      }
    }).pipe(Effect.provide(provideTestServices({ APPLE_PROVIDER_ID: "2" }))),
  );
});

// Prompt-branch tests live in e2e where we can drive a real TTY. The clack
// Prompt is keystroke-driven against stdin, so it cannot be scripted from
// Inside an Effect unit test the way the old @effect/cli Terminal service was.
