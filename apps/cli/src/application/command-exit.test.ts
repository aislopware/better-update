import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { InteractiveProhibitedError } from "../lib/exit-codes";
import { makeInteractiveModeLayer } from "../lib/interactive-mode";
import { makeOutputModeLayer } from "../lib/output-mode";
import { promptText } from "../lib/prompts";
import { CliRuntime } from "../services/cli-runtime";
import { exitWith } from "./command-exit";

// Capture setExitCode without touching process.exitCode.
const exitCodeStub = () => {
  const codes: number[] = [];
  return {
    codes,
    layer: Layer.succeed(CliRuntime, {
      argv: [],
      platform: "linux" as NodeJS.Platform,
      cwd: Effect.succeed("/"),
      getEnv: () => Effect.succeed(undefined),
      homeDirectory: Effect.succeed("/"),
      userName: Effect.succeed("test"),
      commandEnvironment: () => Effect.succeed({}),
      setExitCode: (code: number) =>
        Effect.sync(() => {
          codes.push(code);
        }),
    }),
  };
};

describe("exitWith (OutputMode-aware error emission)", () => {
  const originalArgv = process.argv;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.argv = ["node", "cli.js", "update", "publish"];
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.argv = originalArgv;
  });

  it.effect("JSON mode emits the error envelope on stdout + sets exit code, no stderr", () => {
    const runtime = exitCodeStub();
    return Effect.gen(function* () {
      yield* exitWith(2, {
        tag: "InteractiveProhibitedError",
        message: "Provide the value via a flag, run with --interactive, or unset CI.",
      });
      expect(errorSpy).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledTimes(1);
      const printed = String(logSpy.mock.calls[0]?.[0]);
      expect(printed).not.toContain("\n");
      const parsed = JSON.parse(printed) as Record<string, unknown>;
      expect(parsed).toMatchObject({
        schemaVersion: 1,
        ok: false,
        command: "update.publish",
        error: {
          code: 2,
          tag: "InteractiveProhibitedError",
          message: "Provide the value via a flag, run with --interactive, or unset CI.",
        },
      });
      expect(runtime.codes).toStrictEqual([2]);
    }).pipe(Effect.provide(Layer.mergeAll(makeOutputModeLayer(true), runtime.layer)));
  });

  it.effect("JSON mode surfaces the hint when present", () => {
    const runtime = exitCodeStub();
    return Effect.gen(function* () {
      yield* exitWith(1, {
        tag: "MissingCredentialsError",
        message: "No credentials configured.",
        hint: "Run `better-update credentials configure`.",
      });
      const parsed = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
        error: { hint?: string };
      };
      expect(parsed.error.hint).toBe("Run `better-update credentials configure`.");
    }).pipe(Effect.provide(Layer.mergeAll(makeOutputModeLayer(true), runtime.layer)));
  });

  it.effect("human mode prints the plain message on stderr, no envelope", () => {
    const runtime = exitCodeStub();
    return Effect.gen(function* () {
      yield* exitWith(3, { tag: "AuthRequiredError", message: "Not authenticated." });
      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith("Not authenticated.");
      expect(runtime.codes).toStrictEqual([3]);
    }).pipe(Effect.provide(Layer.mergeAll(makeOutputModeLayer(false), runtime.layer)));
  });
});

describe("prompt gating under InteractiveMode { allow: false }", () => {
  it.effect("promptText fails fast with the actionable InteractiveProhibitedError, no hang", () =>
    Effect.gen(function* () {
      const error = yield* promptText("Project name").pipe(
        // Tight timeout proves it FAILS rather than blocking on @clack.
        Effect.timeoutFail({
          duration: "1 second",
          onTimeout: () => new InteractiveProhibitedError({ message: "hung" }),
        }),
        Effect.flip,
      );
      expect(error).toBeInstanceOf(InteractiveProhibitedError);
      expect(error.message).toContain("non-interactively");
      expect(error.message).toContain("Provide the value via a flag");
    }).pipe(Effect.provide(makeInteractiveModeLayer(false))),
  );
});
