import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Data, Effect, FileSystem, Layer } from "effect";
import { TestConsole } from "effect/testing";

import { CliRuntime } from "../services/cli-runtime";
import { applePortalExitCodes, exitCodeOverrides, handleCommandErrors } from "./command-errors";
import { CommandName } from "./command-output";
import { InteractiveProhibitedError } from "./exit-codes";
import { makeOutputModeLayer } from "./output-mode";

class UnmappedError extends Data.TaggedError("UnmappedError")<{ readonly message: string }> {}

const runtimeStub = () => {
  const codes: number[] = [];
  return {
    codes,
    layer: Layer.succeed(CliRuntime, {
      argv: [],
      platform: "linux",
      cwd: Effect.succeed("/"),
      // @effect-diagnostics-next-line effect/effectSucceedWithVoid:off -- undefined is the success value of getEnv
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

const lastEnvelope = Effect.gen(function* () {
  const lines = yield* TestConsole.logLines;
  return JSON.parse(String(lines.at(-1))) as {
    readonly error: { readonly code: number; readonly tag: string; readonly message: string };
  };
});

describe("handleCommandErrors (exit-code policy boundary)", () => {
  it.effect("maps a known tag through the base policy", () => {
    const runtime = runtimeStub();
    return Effect.gen(function* () {
      yield* handleCommandErrors(
        Effect.fail(new InteractiveProhibitedError({ message: "no prompts" })),
      );
      expect(runtime.codes).toStrictEqual([2]);
      expect((yield* lastEnvelope).error).toStrictEqual({
        code: 2,
        tag: "InteractiveProhibitedError",
        message: "no prompts",
      });
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          makeOutputModeLayer(true),
          runtime.layer,
          Layer.succeed(CommandName, "t.cmd"),
        ),
      ),
    );
  });

  it.effect("a subtree override (apple portal) changes the code for the same tag", () => {
    const runtime = runtimeStub();
    return Effect.gen(function* () {
      yield* handleCommandErrors(
        Effect.fail(new InteractiveProhibitedError({ message: "no prompts" })),
      );
      expect(runtime.codes).toStrictEqual([4]);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(makeOutputModeLayer(true), runtime.layer, applePortalExitCodes),
      ),
    );
  });

  it.effect("exitCodeOverrides keeps the rest of the base map intact", () => {
    const runtime = runtimeStub();
    return Effect.gen(function* () {
      yield* handleCommandErrors(
        Effect.fail(new InteractiveProhibitedError({ message: "no prompts" })),
      );
      expect(runtime.codes).toStrictEqual([2]);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          makeOutputModeLayer(true),
          runtime.layer,
          exitCodeOverrides({ CredentialValidationError: 5 }),
        ),
      ),
    );
  });

  it.effect("an unmapped tag exits 1 as Unknown (the signal to extend the base map)", () => {
    const runtime = runtimeStub();
    return Effect.gen(function* () {
      yield* handleCommandErrors(Effect.fail(new UnmappedError({ message: "boom" })));
      expect(runtime.codes).toStrictEqual([1]);
      expect((yield* lastEnvelope).error.tag).toBe("Unknown");
    }).pipe(Effect.provide(Layer.mergeAll(makeOutputModeLayer(true), runtime.layer)));
  });

  it.effect("a filesystem PlatformError exits 6 with a Filesystem-error message", () => {
    const runtime = runtimeStub();
    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* handleCommandErrors(fs.readFileString("/definitely/missing/file.env"));
      expect(runtime.codes).toStrictEqual([6]);
      const { error } = yield* lastEnvelope;
      expect(error.tag).toBe("PlatformError");
      expect(error.message).toMatch(/^Filesystem error: NotFound/);
    }).pipe(
      Effect.provide(Layer.mergeAll(makeOutputModeLayer(true), runtime.layer, NodeServices.layer)),
    );
  });

  it.effect("success passes through untouched and sets no exit code", () => {
    const runtime = runtimeStub();
    return Effect.gen(function* () {
      yield* handleCommandErrors(Effect.succeed("ok"));
      expect(runtime.codes).toStrictEqual([]);
      expect(yield* TestConsole.logLines).toStrictEqual([]);
    }).pipe(Effect.provide(Layer.mergeAll(makeOutputModeLayer(true), runtime.layer)));
  });
});
