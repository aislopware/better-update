import { CommandExecutor, FileSystem } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import { RuntimeVersionError } from "./exit-codes";
import { resolveRuntimeVersion } from "./runtime-version";
import { failureError } from "./test-utils";

import type { Platform, RawRuntimeVersion } from "./build-profile";

// ── helpers ───────────────────────────────────────────────────────

const makeStubExecutor = (stdout: string): CommandExecutor.CommandExecutor =>
  ({
    [CommandExecutor.TypeId]: CommandExecutor.TypeId,
    string: () => Effect.succeed(stdout),
  }) as unknown as CommandExecutor.CommandExecutor;

/**
 * Minimal FileSystem stub exposing only `readFileString`, the single method
 * `resolveInstalledExpoSdkVersion` calls. `files` maps an absolute path to its
 * contents; any path not present fails with an ENOENT-style SystemError so the
 * resolver's "expo not installed" fallback is exercised.
 */
const makeStubFileSystem = (files: Record<string, string>): FileSystem.FileSystem =>
  FileSystem.makeNoop({
    readFileString: (path) => {
      const content = files[path];
      if (content === undefined) {
        return Effect.fail(
          new SystemError({
            module: "FileSystem",
            method: "readFileString",
            reason: "NotFound",
            pathOrDescriptor: path,
          }),
        );
      }
      return Effect.succeed(content);
    },
  });

const provideStubs = (stdout: string, files: Record<string, string> = {}) =>
  Effect.provide(
    Layer.mergeAll(
      Layer.succeed(CommandExecutor.CommandExecutor, makeStubExecutor(stdout)),
      Layer.succeed(FileSystem.FileSystem, makeStubFileSystem(files)),
    ),
  );

interface Overrides {
  readonly raw: RawRuntimeVersion | undefined;
  readonly appVersion?: string | undefined;
  readonly platform?: Platform;
  readonly buildNumber?: string | undefined;
  readonly sdkVersion?: string | undefined;
}

const resolve = (overrides: Overrides) =>
  resolveRuntimeVersion({
    raw: overrides.raw,
    appVersion: overrides.appVersion,
    projectRoot: ".",
    platform: overrides.platform ?? "ios",
    buildNumber: overrides.buildNumber,
    sdkVersion: overrides.sdkVersion,
  });

// ── tests ─────────────────────────────────────────────────────────

describe(resolveRuntimeVersion, () => {
  it.effect("returns literal string as-is", () =>
    Effect.gen(function* () {
      const result = yield* resolve({ raw: "1.2.3", appVersion: "9.9.9" }).pipe(provideStubs(""));
      expect(result).toBe("1.2.3");
    }),
  );

  it.effect('resolves {policy:"appVersion"} to appVersion', () =>
    Effect.gen(function* () {
      const result = yield* resolve({ raw: { policy: "appVersion" }, appVersion: "2.5.0" }).pipe(
        provideStubs(""),
      );
      expect(result).toBe("2.5.0");
    }),
  );

  it.effect('policy "appVersion" defaults to 1.0.0 when expo.version is missing (EAS parity)', () =>
    Effect.gen(function* () {
      const result = yield* resolve({ raw: { policy: "appVersion" }, appVersion: undefined }).pipe(
        provideStubs(""),
      );
      expect(result).toBe("1.0.0");
    }),
  );

  // ── nativeVersion (per-platform) ─────────────────────────────────

  it.effect('resolves {policy:"nativeVersion"} ios -> "version(buildNumber)"', () =>
    Effect.gen(function* () {
      const result = yield* resolve({
        raw: { policy: "nativeVersion" },
        appVersion: "1.0.0",
        platform: "ios",
        buildNumber: "3",
      }).pipe(provideStubs(""));
      expect(result).toBe("1.0.0(3)");
    }),
  );

  it.effect('resolves {policy:"nativeVersion"} android -> "version(versionCode)"', () =>
    Effect.gen(function* () {
      const result = yield* resolve({
        raw: { policy: "nativeVersion" },
        appVersion: "1.0.0",
        platform: "android",
        buildNumber: "4",
      }).pipe(provideStubs(""));
      expect(result).toBe("1.0.0(4)");
    }),
  );

  it.effect("nativeVersion defaults expo.version to 1.0.0 when missing (EAS parity)", () =>
    Effect.gen(function* () {
      const result = yield* resolve({
        raw: { policy: "nativeVersion" },
        appVersion: undefined,
        buildNumber: "3",
      }).pipe(provideStubs(""));
      expect(result).toBe("1.0.0(3)");
    }),
  );

  it.effect(
    "nativeVersion defaults buildNumber to 1 when ios.buildNumber missing (EAS parity)",
    () =>
      Effect.gen(function* () {
        const result = yield* resolve({
          raw: { policy: "nativeVersion" },
          appVersion: "2.0.0",
          platform: "ios",
          buildNumber: undefined,
        }).pipe(provideStubs(""));
        expect(result).toBe("2.0.0(1)");
      }),
  );

  it.effect(
    "nativeVersion defaults versionCode to 1 when android.versionCode missing (EAS parity)",
    () =>
      Effect.gen(function* () {
        const result = yield* resolve({
          raw: { policy: "nativeVersion" },
          appVersion: "2.0.0",
          platform: "android",
          buildNumber: undefined,
        }).pipe(provideStubs(""));
        expect(result).toBe("2.0.0(1)");
      }),
  );

  it.effect("nativeVersion defaults both version and buildNumber when both missing", () =>
    Effect.gen(function* () {
      const result = yield* resolve({
        raw: { policy: "nativeVersion" },
        appVersion: undefined,
        buildNumber: undefined,
      }).pipe(provideStubs(""));
      expect(result).toBe("1.0.0(1)");
    }),
  );

  // ── sdkVersion ───────────────────────────────────────────────────

  it.effect('resolves {policy:"sdkVersion"} from config.sdkVersion verbatim -> "exposdk:<v>"', () =>
    Effect.gen(function* () {
      // An explicit expo.sdkVersion is used verbatim (matching EAS
      // getRuntimeVersionForSDKVersion), since @expo/config already reduces the
      // value it populates to `${major}.0.0`.
      const result = yield* resolve({
        raw: { policy: "sdkVersion" },
        sdkVersion: "52.0.0",
      }).pipe(provideStubs(""));
      expect(result).toBe("exposdk:52.0.0");
    }),
  );

  it.effect(
    "sdkVersion falls back to the installed expo package version reduced to major.0.0 (EAS parity)",
    () =>
      Effect.gen(function* () {
        // A realistic patch version (52.0.11) must reduce to 52.0.0 to match
        // @expo/config getExpoSDKVersionFromPackage — the device build reports
        // exposdk:52.0.0, not exposdk:52.0.11.
        const result = yield* resolve({
          raw: { policy: "sdkVersion" },
          sdkVersion: undefined,
        }).pipe(provideStubs("", { "node_modules/expo/package.json": '{"version":"52.0.11"}' }));
        expect(result).toBe("exposdk:52.0.0");
      }),
  );

  it.effect("sdkVersion fails when neither config nor installed expo provides a version", () =>
    Effect.gen(function* () {
      const exit = yield* resolve({
        raw: { policy: "sdkVersion" },
        sdkVersion: undefined,
      }).pipe(provideStubs("", {}), Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(RuntimeVersionError);
        expect(error!.message).toContain("Expo SDK version");
      }
    }),
  );

  // ── fingerprint ──────────────────────────────────────────────────

  it.effect('resolves {policy:"fingerprint"} via CommandExecutor JSON hash', () =>
    Effect.gen(function* () {
      const result = yield* resolve({ raw: { policy: "fingerprint" } }).pipe(
        provideStubs('{"hash":"abc123","sources":[]}'),
      );
      expect(result).toBe("abc123");
    }),
  );

  it.effect("fails when fingerprint stdout is not JSON", () =>
    Effect.gen(function* () {
      const exit = yield* resolve({ raw: { policy: "fingerprint" } }).pipe(
        provideStubs("not-json"),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(RuntimeVersionError);
      }
    }),
  );

  it.effect("fails when fingerprint JSON has no hash field", () =>
    Effect.gen(function* () {
      const exit = yield* resolve({ raw: { policy: "fingerprint" } }).pipe(
        provideStubs('{"sources":[]}'),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  // ── misc ─────────────────────────────────────────────────────────

  it.effect("fails on an unknown policy and lists the valid policies", () =>
    Effect.gen(function* () {
      const exit = yield* resolve({ raw: { policy: "bogus" } }).pipe(provideStubs(""), Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(RuntimeVersionError);
        expect(error!.message).toContain("nativeVersion");
        expect(error!.message).toContain("sdkVersion");
      }
    }),
  );

  it.effect("fails when runtimeVersion is missing entirely", () =>
    Effect.gen(function* () {
      const exit = yield* resolve({ raw: undefined, appVersion: "1.0.0" }).pipe(
        provideStubs(""),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );
});
