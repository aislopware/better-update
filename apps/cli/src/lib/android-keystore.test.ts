import { CommandExecutor } from "@effect/platform";
import { it } from "@effect/vitest";
import { Data, Effect, Exit } from "effect";

import {
  extractKeystoreCertificate,
  generateAndroidKeystore,
  parseKeystoreCertificatePem,
  readKeystoreCertificate,
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

// `keytool -list -rfc` against a throwaway JKS built for these tests:
// CN=Example App, O=Example Corp, RSA 2048, 3650 days.
const KEYTOOL_RFC_OUTPUT = `Alias name: release
Creation date: Aug 9, 2026
Entry type: PrivateKeyEntry
Certificate chain length: 1
Certificate[1]:
-----BEGIN CERTIFICATE-----
MIIC/jCCAeagAwIBAgIJAL1WKahi49NfMA0GCSqGSIb3DQEBCwUAMC0xFTATBgNV
BAoTDEV4YW1wbGUgQ29ycDEUMBIGA1UEAxMLRXhhbXBsZSBBcHAwHhcNMjYwODA5
MDY0MTQzWhcNMzYwODA2MDY0MTQzWjAtMRUwEwYDVQQKEwxFeGFtcGxlIENvcnAx
FDASBgNVBAMTC0V4YW1wbGUgQXBwMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIB
CgKCAQEA4E6LYuB9SkJzspF3U/wLEohP/GulTV0Omhg3fvd66hv7ARQ1mI3qut0V
DvACFEMtRH+zR9ColHUQCUygAq1WB/8gH0yDgr3O1qIY5890CF43jOsTeaURMyw1
0vPFVS2m+vNRkwDdOS6dklTh4UmiIHO3fNPnBC4EV17bnrtlU2w2yCZx29BAJY4S
B2/sIkcDAcUpvpe+8SRm7DV8BWsge+6aQZWP6LXPuN0ANR5eyqW92KBC7Jt1+wEY
nD7pJu4tDU0NuEqKPgyw6Wlzk5GE68sL/45ijpGnxtP6kjfqEseCpNZRNNsGnpv1
uz6bmrktOcy9qj4dqCYdcUq41IW1NwIDAQABoyEwHzAdBgNVHQ4EFgQUvvz2E/cu
uFiOajqS+BV4VyTP4k0wDQYJKoZIhvcNAQELBQADggEBAG8AUSNFP2LLGbZAbaP3
jlDj5BgO4Z1De3lcrA741ebOLDIBOM4jR13pbB0v0q3Wq1usHc/cTLzFhDGSjIac
DtJbD2Mtxmv8Aj5DAD9buxw5LmtMArCNXIOd/EuvHFg3GJemMePJJdMHUTDPNuoY
1qzPdYpOATgyFq53eZi1osk5hjTs+EDkdgzxA5ZDMJHIzZTNDfMZ2334Zms3VFN9
idsUsTzMqDe4NN6oAuMVnn1sJ+gboCxWlPHBYHGtiCMVrhGG2bhghGGlk/A6wbPq
fx+QPDPlP6lfeaXfeP5oABam4lACbs+bCFOZztOdOYDgAIO1FBK49IByTiSYPG0e
ZTM=
-----END CERTIFICATE-----
`;

const FIXTURE_SHA1 = "AE:C8:E5:F6:0F:5C:3E:FD:62:43:3B:11:4B:38:59:57:2D:7C:BD:D8";
const FIXTURE_SHA256 =
  "85:82:60:B8:6C:BF:2D:DE:B5:96:EB:9A:AC:B8:D4:C5:5C:3E:35:1B:55:06:93:00:C6:14:ED:15:C5:4B:BC:9A";
const FIXTURE_MD5 = "DA:74:11:5F:7B:AB:75:F2:26:D9:88:5F:3B:66:59:96";
const FIXTURE_VALID_UNTIL = "2036-08-06T06:41:43.000Z";

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

  it("parseKeystoreCertificatePem lifts the leaf PEM out of keytool's prose", () => {
    const pem = parseKeystoreCertificatePem(KEYTOOL_RFC_OUTPUT);
    expect(pem?.startsWith("-----BEGIN CERTIFICATE-----")).toBe(true);
    expect(pem?.endsWith("-----END CERTIFICATE-----")).toBe(true);
    expect(pem).not.toContain("Alias name");
  });

  // A chain prints issuers after the leaf; only the leaf describes this key.
  it("parseKeystoreCertificatePem takes the first certificate of a chain", () => {
    const chain = `${KEYTOOL_RFC_OUTPUT}\nCertificate[2]:\n-----BEGIN CERTIFICATE-----\nZm9v\n-----END CERTIFICATE-----\n`;
    expect(parseKeystoreCertificatePem(chain)).toBe(
      parseKeystoreCertificatePem(KEYTOOL_RFC_OUTPUT),
    );
  });

  it("parseKeystoreCertificatePem returns undefined for keytool's error output", () => {
    expect(
      parseKeystoreCertificatePem(
        "keytool error: java.io.IOException: keystore password was incorrect",
      ),
    ).toBeUndefined();
  });

  it("readKeystoreCertificate reports keytool's own fingerprints plus the expiry", () => {
    const pem = parseKeystoreCertificatePem(KEYTOOL_RFC_OUTPUT);
    const certificate = readKeystoreCertificate(pem!);

    expect(certificate.sha1).toBe(FIXTURE_SHA1);
    expect(certificate.sha256).toBe(FIXTURE_SHA256);
    // Modern JDKs drop MD5 from `keytool -list -v`; digesting the DER ourselves
    // brings it back rather than storing a null the dashboard has to explain.
    expect(certificate.md5).toBe(FIXTURE_MD5);
    expect(certificate.validUntil).toBe(FIXTURE_VALID_UNTIL);
  });

  it.effect("extractKeystoreCertificate reads keytool -list -rfc stdout", () =>
    Effect.gen(function* () {
      const certificate = yield* extractKeystoreCertificate({
        keystorePath: "/tmp/release.keystore",
        keyAlias: "release",
        storePassword: "store-pass",
      }).pipe(provideStringStubExecutor(() => Effect.succeed(KEYTOOL_RFC_OUTPUT)));

      expect(certificate.sha256).toBe(FIXTURE_SHA256);
      expect(certificate.validUntil).toBe(FIXTURE_VALID_UNTIL);
    }),
  );

  it.effect("extractKeystoreCertificate asks keytool for PEM, not the -v report", () =>
    Effect.gen(function* () {
      let executedCommand: Record<string, unknown> | undefined;
      yield* extractKeystoreCertificate({
        keystorePath: "/tmp/release.keystore",
        keyAlias: "release",
        storePassword: "store-pass",
      }).pipe(
        provideStringStubExecutor((command) => {
          executedCommand = command as Record<string, unknown>;
          return Effect.succeed(KEYTOOL_RFC_OUTPUT);
        }),
      );

      // The env pin matters as much as the flag: keytool localises its prose.
      expect(executedCommand?.["args"]).toContain("-rfc");
      expect(executedCommand?.["env"]).toBeDefined();
    }),
  );

  it.effect("extractKeystoreCertificate fails when keytool surfaces no certificate", () =>
    Effect.gen(function* () {
      const exit = yield* extractKeystoreCertificate({
        keystorePath: "/tmp/release.keystore",
        keyAlias: "release",
        storePassword: "wrong-pass",
      }).pipe(
        // `Command.string` resolves with stdout even on a non-zero exit, so a wrong
        // password yields an error blob with no PEM block.
        provideStringStubExecutor(() =>
          Effect.succeed("keytool error: java.io.IOException: keystore password was incorrect"),
        ),
        Effect.exit,
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(BuildFailedError);
        expect(error!.message).toContain("no certificate");
      }
    }),
  );

  it.effect("extractKeystoreCertificate fails on a PEM block that is not a certificate", () =>
    Effect.gen(function* () {
      const exit = yield* extractKeystoreCertificate({
        keystorePath: "/tmp/release.keystore",
        keyAlias: "release",
        storePassword: "store-pass",
      }).pipe(
        provideStringStubExecutor(() =>
          Effect.succeed("-----BEGIN CERTIFICATE-----\nnot base64 der\n-----END CERTIFICATE-----"),
        ),
        Effect.exit,
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(failureError(exit)!.message).toContain("could not be parsed");
      }
    }),
  );

  it.effect("extractKeystoreCertificate maps a spawn failure to BuildFailedError", () =>
    Effect.gen(function* () {
      const exit = yield* extractKeystoreCertificate({
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
