import { CommandExecutor } from "@effect/platform";
import { it } from "@effect/vitest";
import { Data, Effect, Exit } from "effect";

import { generateAndroidKeystore, renderDistinguishedName } from "./android-keystore";
import { BuildFailedError } from "./exit-codes";
import { failureError } from "./test-utils";

class SpawnFailedError extends Data.TaggedError("SpawnFailedError")<{
  message: string;
  cause?: unknown;
}> {}

const makeStubExecutor = (
  exitCode: (command: unknown) => Effect.Effect<CommandExecutor.ExitCode, unknown>,
): CommandExecutor.CommandExecutor =>
  ({
    [CommandExecutor.TypeId]: CommandExecutor.TypeId,
    exitCode,
  }) as unknown as CommandExecutor.CommandExecutor;

const provideStubExecutor = (
  exitCode: (command: unknown) => Effect.Effect<CommandExecutor.ExitCode, unknown>,
) => Effect.provideService(CommandExecutor.CommandExecutor, makeStubExecutor(exitCode));

describe("android keystore helpers", () => {
  it("renderDistinguishedName formats CN and O", () => {
    expect(
      renderDistinguishedName({
        commonName: "Jane Doe",
        organization: "Acme Inc",
      }),
    ).toBe("CN=Jane Doe, O=Acme Inc");
  });

  it.effect("generateAndroidKeystore runs keytool with expected arguments", () =>
    Effect.gen(function* () {
      let executedCommand: Record<string, unknown> | undefined;

      yield* generateAndroidKeystore({
        outputPath: "/tmp/release.keystore",
        keyAlias: "release-key",
        storePassword: "store-pass",
        keyPassword: "key-pass",
        commonName: "Jane Doe",
        organization: "Acme Inc",
      }).pipe(
        provideStubExecutor((command) => {
          executedCommand = command as Record<string, unknown>;
          return Effect.succeed(CommandExecutor.ExitCode(0));
        }),
      );

      expect(executedCommand?.["command"]).toBe("keytool");
      expect(executedCommand?.["args"]).toStrictEqual(
        expect.arrayContaining([
          "-genkeypair",
          "-keystore",
          "/tmp/release.keystore",
          "-alias",
          "release-key",
          "-storepass",
          "store-pass",
          "-keypass",
          "key-pass",
          "-dname",
          "CN=Jane Doe, O=Acme Inc",
          "-noprompt",
        ]),
      );
    }),
  );

  it.effect("generateAndroidKeystore fails with BuildFailedError on non-zero exit", () =>
    Effect.gen(function* () {
      const exit = yield* generateAndroidKeystore({
        outputPath: "/tmp/release.keystore",
        keyAlias: "release-key",
        storePassword: "store-pass",
        keyPassword: "key-pass",
        commonName: "Jane Doe",
        organization: "Acme Inc",
      }).pipe(
        provideStubExecutor(() => Effect.succeed(CommandExecutor.ExitCode(23))),
        Effect.exit,
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(BuildFailedError);
        expect(error!.message).toContain("exited with code 23");
      }
    }),
  );

  it.effect("generateAndroidKeystore fails with BuildFailedError when spawning fails", () =>
    Effect.gen(function* () {
      const exit = yield* generateAndroidKeystore({
        outputPath: "/tmp/release.keystore",
        keyAlias: "release-key",
        storePassword: "store-pass",
        keyPassword: "key-pass",
        commonName: "Jane Doe",
        organization: "Acme Inc",
      }).pipe(
        provideStubExecutor(() => Effect.fail(new SpawnFailedError({ message: "spawn failed" }))),
        Effect.exit,
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(BuildFailedError);
        expect(error!.message).toContain("failed to spawn");
      }
    }),
  );
});
