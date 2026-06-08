import { CommandExecutor } from "@effect/platform";
import { it } from "@effect/vitest";
import { Data, Effect, Exit } from "effect";

import {
  extractKeystoreFingerprints,
  generateAndroidKeystore,
  parseKeystoreFingerprints,
  renderDistinguishedName,
} from "./android-keystore";
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

const makeStringStubExecutor = (
  string: (command: unknown) => Effect.Effect<string, unknown>,
): CommandExecutor.CommandExecutor =>
  ({
    [CommandExecutor.TypeId]: CommandExecutor.TypeId,
    string,
  }) as unknown as CommandExecutor.CommandExecutor;

const provideStringStubExecutor = (string: (command: unknown) => Effect.Effect<string, unknown>) =>
  Effect.provideService(CommandExecutor.CommandExecutor, makeStringStubExecutor(string));

const KEYTOOL_LIST_OUTPUT = `Alias name: release
Creation date: Jan 1, 2024
Entry type: PrivateKeyEntry
Certificate fingerprints:
\t SHA1: AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD
\t SHA256: 11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00
Signature algorithm name: SHA256withRSA
`;

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

  it("parseKeystoreFingerprints reads SHA1/SHA256 from keytool -list output", () => {
    const fingerprints = parseKeystoreFingerprints(KEYTOOL_LIST_OUTPUT);
    expect(fingerprints.sha1).toBe("AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD");
    expect(fingerprints.sha256).toBe(
      "11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00",
    );
    // Modern JDKs drop MD5 from `-v` output; the field stays undefined.
    expect(fingerprints.md5).toBeUndefined();
  });

  it("parseKeystoreFingerprints tolerates hyphenated labels and reads MD5 when present", () => {
    const fingerprints = parseKeystoreFingerprints(
      "\t MD5:  12:34:56\n\t SHA-1: AB:CD:EF\n\t SHA-256: 00:11:22\n",
    );
    expect(fingerprints.md5).toBe("12:34:56");
    expect(fingerprints.sha1).toBe("AB:CD:EF");
    expect(fingerprints.sha256).toBe("00:11:22");
  });

  it("parseKeystoreFingerprints does not mistake SHA256withRSA for a fingerprint", () => {
    const fingerprints = parseKeystoreFingerprints("Signature algorithm name: SHA256withRSA\n");
    expect(fingerprints.sha256).toBeUndefined();
  });

  it.effect("extractKeystoreFingerprints parses keytool -list -v stdout", () =>
    Effect.gen(function* () {
      const fingerprints = yield* extractKeystoreFingerprints({
        keystorePath: "/tmp/release.keystore",
        keyAlias: "release",
        storePassword: "store-pass",
      }).pipe(provideStringStubExecutor(() => Effect.succeed(KEYTOOL_LIST_OUTPUT)));

      expect(fingerprints.sha1).toBe("AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD");
      expect(fingerprints.sha256).toBe(
        "11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00",
      );
    }),
  );

  it.effect("extractKeystoreFingerprints fails when keytool surfaces no fingerprints", () =>
    Effect.gen(function* () {
      const exit = yield* extractKeystoreFingerprints({
        keystorePath: "/tmp/release.keystore",
        keyAlias: "release",
        storePassword: "wrong-pass",
      }).pipe(
        // `Command.string` resolves with stdout even on a non-zero exit, so a wrong
        // password yields an error blob with no fingerprint lines.
        provideStringStubExecutor(() =>
          Effect.succeed("keytool error: java.io.IOException: keystore password was incorrect"),
        ),
        Effect.exit,
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(BuildFailedError);
        expect(error!.message).toContain("no SHA-1/SHA-256 fingerprints");
      }
    }),
  );

  it.effect("extractKeystoreFingerprints maps a spawn failure to BuildFailedError", () =>
    Effect.gen(function* () {
      const exit = yield* extractKeystoreFingerprints({
        keystorePath: "/tmp/release.keystore",
        keyAlias: "release",
        storePassword: "store-pass",
      }).pipe(
        provideStringStubExecutor(() =>
          Effect.fail(new SpawnFailedError({ message: "keytool not found" })),
        ),
        Effect.exit,
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(BuildFailedError);
        expect(error!.message).toContain("keytool -list failed to run");
      }
    }),
  );
});
