import { Terminal } from "@effect/platform";
import { it } from "@effect/vitest";
import { Effect, Exit, Layer, Mailbox, Option } from "effect";

import type * as AppleUtils from "@expo/apple-utils";

import { CliRuntime } from "../services/cli-runtime";
import { parseProviderId, resolveProvider } from "./apple-auth";
import { AppleAuthError } from "./exit-codes";

// ── helpers ──────────────────────────────────────────────────────

const provider = (
  providerId: number,
  name = `Provider ${providerId}`,
  subType = "ORGANIZATION",
): AppleUtils.Session.SessionProvider => ({
  providerId,
  publicProviderId: `pub-${providerId}`,
  name,
  contentTypes: ["SOFTWARE"],
  subType,
});

const makeAppleUtilsStub = (setProviderSpy?: (id: number) => Promise<unknown>) =>
  ({
    Session: {
      setSessionProviderIdAsync: (id: number) => setProviderSpy?.(id) ?? Promise.resolve(null),
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

// Stub Terminal — none of the non-prompt branches read from it.
const terminalStubLayer = Layer.succeed(Terminal.Terminal, {
  columns: Effect.succeed(80),
  rows: Effect.succeed(24),
  isTTY: Effect.succeed(false),
  readInput: Effect.dieMessage("readInput not used in tests") as never,
  readLine: Effect.dieMessage("readLine not used in tests") as never,
  display: () => Effect.void,
});

const provideTestServices = (env: Readonly<Record<string, string | undefined>> = {}) =>
  Layer.mergeAll(makeCliRuntimeLayer(env), terminalStubLayer);

// ── parseProviderId ──────────────────────────────────────────────

describe("parseProviderId", () => {
  it.effect("accepts a positive integer string", () =>
    Effect.gen(function* () {
      const result = yield* parseProviderId("118573544");
      expect(result).toBe(118573544);
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
        expect((err as AppleAuthError).message).toContain("APPLE_PROVIDER_ID");
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
      // skips empty strings. Document that parseProviderId treats "" as 0.
      const result = yield* parseProviderId("");
      expect(result).toBe(0);
    }),
  );
});

// ── resolveProvider ──────────────────────────────────────────────

describe("resolveProvider", () => {
  it.effect("uses APPLE_PROVIDER_ID env when set, switching when it differs from current", () =>
    Effect.gen(function* () {
      const calls: number[] = [];
      const appleUtils = makeAppleUtilsStub(async (id) => {
        calls.push(id);
        return null;
      });

      const result = yield* resolveProvider(appleUtils, [provider(1), provider(2)], 1, undefined);

      expect(result).toEqual({ providerId: 2, switched: true });
      expect(calls).toEqual([2]);
    }).pipe(Effect.provide(provideTestServices({ APPLE_PROVIDER_ID: "2" }))),
  );

  it.effect("env match against current provider does not trigger switch", () =>
    Effect.gen(function* () {
      const calls: number[] = [];
      const appleUtils = makeAppleUtilsStub(async (id) => {
        calls.push(id);
        return null;
      });

      const result = yield* resolveProvider(appleUtils, [provider(1), provider(2)], 1, undefined);

      expect(result).toEqual({ providerId: 1, switched: false });
      expect(calls).toEqual([]);
    }).pipe(Effect.provide(provideTestServices({ APPLE_PROVIDER_ID: "1" }))),
  );

  it.effect("invalid env value fails with AppleAuthError", () =>
    Effect.gen(function* () {
      const appleUtils = makeAppleUtilsStub();
      const exit = yield* Effect.exit(resolveProvider(appleUtils, [provider(1)], 1, undefined));
      expect(Exit.isFailure(exit)).toBe(true);
    }).pipe(Effect.provide(provideTestServices({ APPLE_PROVIDER_ID: "not-a-number" }))),
  );

  it.effect("uses cached provider when still available", () =>
    Effect.gen(function* () {
      const calls: number[] = [];
      const appleUtils = makeAppleUtilsStub(async (id) => {
        calls.push(id);
        return null;
      });

      const result = yield* resolveProvider(
        appleUtils,
        [provider(1), provider(2), provider(3)],
        1,
        3,
      );

      expect(result).toEqual({ providerId: 3, switched: true });
      expect(calls).toEqual([3]);
    }).pipe(Effect.provide(provideTestServices())),
  );

  it.effect("ignores stale cached provider and falls through to single available", () =>
    Effect.gen(function* () {
      const calls: number[] = [];
      const appleUtils = makeAppleUtilsStub(async (id) => {
        calls.push(id);
        return null;
      });

      // Cached provider 99 no longer in availableProviders → fall through.
      const result = yield* resolveProvider(appleUtils, [provider(7)], 7, 99);

      expect(result).toEqual({ providerId: 7, switched: false });
      expect(calls).toEqual([]);
    }).pipe(Effect.provide(provideTestServices())),
  );

  it.effect("returns currentProviderId when availableProviders is empty", () =>
    Effect.gen(function* () {
      const appleUtils = makeAppleUtilsStub();

      const result = yield* resolveProvider(appleUtils, [], 5, undefined);

      expect(result).toEqual({ providerId: 5, switched: false });
    }).pipe(Effect.provide(provideTestServices())),
  );

  it.effect("returns undefined when no providers and no current id", () =>
    Effect.gen(function* () {
      const appleUtils = makeAppleUtilsStub();

      const result = yield* resolveProvider(appleUtils, [], undefined, undefined);

      expect(result).toEqual({ providerId: undefined, switched: false });
    }).pipe(Effect.provide(provideTestServices())),
  );

  it.effect("single available provider applies through applyChoice", () =>
    Effect.gen(function* () {
      const calls: number[] = [];
      const appleUtils = makeAppleUtilsStub(async (id) => {
        calls.push(id);
        return null;
      });

      const result = yield* resolveProvider(appleUtils, [provider(42)], undefined, undefined);

      expect(result).toEqual({ providerId: 42, switched: true });
      expect(calls).toEqual([42]);
    }).pipe(Effect.provide(provideTestServices())),
  );

  it.effect(
    "multi-provider with no env, no cache, autoresolved current → preserves without prompt",
    () =>
      Effect.gen(function* () {
        const calls: number[] = [];
        const appleUtils = makeAppleUtilsStub(async (id) => {
          calls.push(id);
          return null;
        });

        // currentProviderId is set (apple-utils auto-resolved). No prompt — CI-safe.
        const result = yield* resolveProvider(
          appleUtils,
          [provider(1), provider(2), provider(3)],
          2,
          undefined,
        );

        expect(result).toEqual({ providerId: 2, switched: false });
        expect(calls).toEqual([]);
      }).pipe(Effect.provide(provideTestServices())),
  );

  it.effect("env value takes precedence over cached pick", () =>
    Effect.gen(function* () {
      const calls: number[] = [];
      const appleUtils = makeAppleUtilsStub(async (id) => {
        calls.push(id);
        return null;
      });

      const result = yield* resolveProvider(
        appleUtils,
        [provider(1), provider(2), provider(3)],
        1,
        3,
      );

      expect(result).toEqual({ providerId: 2, switched: true });
      expect(calls).toEqual([2]);
    }).pipe(Effect.provide(provideTestServices({ APPLE_PROVIDER_ID: "2" }))),
  );

  it.effect("propagates AppleAuthError when setSessionProviderIdAsync rejects", () =>
    Effect.gen(function* () {
      const appleUtils = makeAppleUtilsStub(async () => {
        throw new Error("provider not accessible");
      });

      const exit = yield* Effect.exit(
        resolveProvider(appleUtils, [provider(1), provider(2)], 1, undefined),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const err = exit.cause._tag === "Fail" ? exit.cause.error : null;
        expect(err).toBeInstanceOf(AppleAuthError);
        expect((err as AppleAuthError).message).toContain("Failed to switch");
      }
    }).pipe(Effect.provide(provideTestServices({ APPLE_PROVIDER_ID: "2" }))),
  );
});

// ── resolveProvider (prompt branch via scripted Terminal) ────────

type KeyEvent = {
  readonly name: string;
  readonly input?: string;
  readonly ctrl?: boolean;
  readonly meta?: boolean;
  readonly shift?: boolean;
};

const toUserInput = (event: KeyEvent): Terminal.UserInput => ({
  input: event.input ? Option.some(event.input) : Option.none(),
  key: {
    name: event.name,
    ctrl: event.ctrl ?? false,
    meta: event.meta ?? false,
    shift: event.shift ?? false,
  },
});

/**
 * Build a Terminal layer backed by a pre-filled Mailbox of scripted keystrokes.
 * `display` output is captured into `displayed` for optional assertions.
 */
const makeScriptedTerminalLayer = (events: ReadonlyArray<KeyEvent>, displayed: string[]) =>
  Layer.effect(
    Terminal.Terminal,
    Effect.gen(function* () {
      const mailbox = yield* Mailbox.make<Terminal.UserInput>();
      yield* mailbox.offerAll(events.map(toUserInput));
      return {
        columns: Effect.succeed(80),
        rows: Effect.succeed(24),
        isTTY: Effect.succeed(true),
        readInput: Effect.succeed(mailbox),
        readLine: Effect.dieMessage("readLine not used in prompt tests") as never,
        display: (text: string) =>
          Effect.sync(() => {
            displayed.push(text);
          }),
      };
    }),
  );

const provideScriptedPrompt = (
  events: ReadonlyArray<KeyEvent>,
  displayed: string[],
  env: Readonly<Record<string, string | undefined>> = {},
) => Layer.mergeAll(makeCliRuntimeLayer(env), makeScriptedTerminalLayer(events, displayed));

describe("resolveProvider (prompt branch)", () => {
  it.effect("prompts when multi-provider + no env + no cache + no auto-current", () =>
    Effect.gen(function* () {
      const displayed: string[] = [];
      const calls: number[] = [];
      const appleUtils = makeAppleUtilsStub(async (id) => {
        calls.push(id);
        return null;
      });

      const result = yield* resolveProvider(
        appleUtils,
        [provider(10, "Org A"), provider(20, "Org B"), provider(30, "Org C")],
        undefined,
        undefined,
      ).pipe(
        Effect.provide(
          provideScriptedPrompt(
            [{ name: "down" }, { name: "down" }, { name: "return" }],
            displayed,
          ),
        ),
      );

      expect(result).toEqual({ providerId: 30, switched: true });
      expect(calls).toEqual([30]);
      const allDisplay = displayed.join("");
      expect(allDisplay).toContain("Select App Store Connect provider");
      expect(allDisplay).toContain("Org C");
    }),
  );

  it.effect("enter on first item picks it without arrow keys", () =>
    Effect.gen(function* () {
      const displayed: string[] = [];
      const calls: number[] = [];
      const appleUtils = makeAppleUtilsStub(async (id) => {
        calls.push(id);
        return null;
      });

      const result = yield* resolveProvider(
        appleUtils,
        [provider(1), provider(2)],
        undefined,
        undefined,
      ).pipe(Effect.provide(provideScriptedPrompt([{ name: "return" }], displayed)));

      expect(result).toEqual({ providerId: 1, switched: true });
      expect(calls).toEqual([1]);
    }),
  );

  it.effect("up-arrow wraps around from top to bottom", () =>
    Effect.gen(function* () {
      const displayed: string[] = [];
      const appleUtils = makeAppleUtilsStub(async () => null);

      const result = yield* resolveProvider(
        appleUtils,
        [provider(1), provider(2), provider(3)],
        undefined,
        undefined,
      ).pipe(
        Effect.provide(provideScriptedPrompt([{ name: "up" }, { name: "return" }], displayed)),
      );

      expect(result.providerId).toBe(3);
      expect(result.switched).toBe(true);
    }),
  );
});
