import path from "node:path";

import { Command, FileSystem } from "@effect/platform";
import { Effect } from "effect";

import type { CommandExecutor } from "@effect/platform";

import { parsePlist, parsePlistXml } from "./plist";
import { printWarn } from "./warning-style";

export interface ExpectedSignedTarget {
  /** Runtime bundle identifier from the bundle's Info.plist. */
  readonly bundleId: string;
  /** UUID of the provisioning profile that should sign this target. */
  readonly profileUuid: string;
}

export interface IosValidationParams {
  readonly archivePath: string;
  /** Main app + all extension targets, each with its own bundle ID + profile UUID. */
  readonly expectedTargets: readonly ExpectedSignedTarget[];
  /** Shared team ID across all targets. */
  readonly expectedTeamId: string;
}

/**
 * Validate an iOS build after xcodebuild completes. For each expected target
 * (main app + extensions), checks:
 * 1. Bundle ID matches expected value (Info.plist)
 * 2. Provisioning profile UUID matches (embedded.mobileprovision)
 * 3. Team ID matches (shared across targets)
 * 4. Profile is not expired
 *
 * Also warns about unexpected extensions found in the archive that were not in
 * the expected list. All checks are non-blocking — returns warnings, never
 * fails the build.
 */
interface BundleValidationResult {
  readonly bundleId: string | undefined;
  readonly warnings: readonly string[];
}

const validateOneBundle = (
  bundleDir: string,
  expectedByBundleId: ReadonlyMap<string, ExpectedSignedTarget>,
  expectedTeamId: string,
): Effect.Effect<
  BundleValidationResult,
  never,
  CommandExecutor.CommandExecutor | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const bundleId = yield* readBundleId(bundleDir).pipe(Effect.orElseSucceed(() => undefined));
    if (!bundleId) {
      return {
        bundleId: undefined,
        warnings: [`Missing CFBundleIdentifier in Info.plist at ${bundleDir}`],
      };
    }
    const expected = expectedByBundleId.get(bundleId);
    if (!expected) {
      return {
        bundleId,
        warnings: [`Unexpected signed bundle "${bundleId}" found in archive at ${bundleDir}`],
      };
    }
    const profileWarnings = yield* validateEmbeddedProfile(
      bundleDir,
      expected.profileUuid,
      expectedTeamId,
      bundleId,
    ).pipe(Effect.orElseSucceed(() => [] as readonly string[]));
    return { bundleId, warnings: profileWarnings };
  });

export const validateIosBuild = (params: IosValidationParams) =>
  Effect.gen(function* () {
    const appDir = yield* findAppDirectory(params.archivePath).pipe(
      Effect.orElseSucceed(() => undefined),
    );

    if (!appDir) {
      const warnings = ["Could not locate .app bundle in archive — skipping post-build validation"];
      return { passed: false, warnings };
    }

    const bundleDirs = yield* listSignedBundleDirs(appDir).pipe(
      Effect.orElseSucceed(() => [appDir]),
    );
    const expectedByBundleId = new Map(
      params.expectedTargets.map((target) => [target.bundleId, target]),
    );

    // eslint-disable-next-line unicorn/no-array-method-this-argument -- false positive: Effect.forEach(array, callback) is not Array.prototype.forEach
    const perBundle = yield* Effect.forEach(bundleDirs, (bundleDir) =>
      validateOneBundle(bundleDir, expectedByBundleId, params.expectedTeamId),
    );

    const warnings: string[] = perBundle.flatMap((entry) => [...entry.warnings]);
    const validatedBundleIds = new Set(
      perBundle.map((entry) => entry.bundleId).filter((id): id is string => id !== undefined),
    );

    for (const expected of params.expectedTargets) {
      if (!validatedBundleIds.has(expected.bundleId)) {
        warnings.push(
          `Expected signed target "${expected.bundleId}" was not found in the archive.`,
        );
      }
    }

    if (warnings.length > 0) {
      yield* printWarn("Post-build validation warnings:");
      for (const warning of warnings) {
        yield* printWarn(`  - ${warning}`);
      }
    }

    return { passed: warnings.length === 0, warnings };
  });

// ── helpers ──────────────────────────────────────────────────────

const findAppDirectory = (
  archivePath: string,
): Effect.Effect<string, unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const productsDir = path.join(archivePath, "Products", "Applications");
    const entries = yield* fs.readDirectory(productsDir);
    const appEntry = entries.find((entry) => entry.endsWith(".app"));
    if (!appEntry) {
      return yield* Effect.fail("No .app found");
    }
    return path.join(productsDir, appEntry);
  });

/**
 * Return the main `.app` plus every `.appex` extension under `<app>/PlugIns/`.
 * Each returned path is a signed bundle that should carry its own embedded
 * provisioning profile + Info.plist with CFBundleIdentifier.
 */
const listSignedBundleDirs = (
  appDir: string,
): Effect.Effect<readonly string[], unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const plugInsDir = path.join(appDir, "PlugIns");
    const plugInsExists = yield* fs.exists(plugInsDir).pipe(Effect.orElseSucceed(() => false));
    if (!plugInsExists) {
      return [appDir];
    }
    const entries = yield* fs.readDirectory(plugInsDir);
    const appexDirs = entries
      .filter((entry) => entry.endsWith(".appex"))
      .map((entry) => path.join(plugInsDir, entry));
    return [appDir, ...appexDirs];
  });

const readBundleId = (
  bundleDir: string,
): Effect.Effect<string | undefined, unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const plistPath = path.join(bundleDir, "Info.plist");
    const data = yield* fs.readFile(plistPath);
    const parsed = parsePlist(Buffer.from(data));
    const bundleId = parsed["CFBundleIdentifier"];
    return typeof bundleId === "string" ? bundleId : undefined;
  });

const validateEmbeddedProfile = (
  bundleDir: string,
  expectedUuid: string,
  expectedTeamId: string,
  bundleId: string,
): Effect.Effect<
  readonly string[],
  unknown,
  CommandExecutor.CommandExecutor | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const warnings: string[] = [];
    const profilePath = path.join(bundleDir, "embedded.mobileprovision");

    const plistXml = yield* Command.string(
      Command.make("security", "cms", "-D", "-i", profilePath),
    );

    const parsed = parsePlistXml(plistXml);

    const actualUuid = parsed["UUID"];
    if (typeof actualUuid === "string" && actualUuid !== expectedUuid) {
      warnings.push(
        `[${bundleId}] Profile UUID mismatch: expected "${expectedUuid}", got "${actualUuid}"`,
      );
    }

    const teamIdentifiers = parsed["TeamIdentifier"];
    if (Array.isArray(teamIdentifiers)) {
      // eslint-disable-next-line typescript/no-unsafe-assignment -- @expo/plist types array entries as any; narrowed via typeof check below
      const [actualTeamId] = teamIdentifiers;
      if (typeof actualTeamId === "string" && actualTeamId !== expectedTeamId) {
        warnings.push(
          `[${bundleId}] Team ID mismatch: expected "${expectedTeamId}", got "${actualTeamId}"`,
        );
      }
    }

    const expirationDate = parsed["ExpirationDate"];
    if (expirationDate instanceof Date && expirationDate.getTime() < Date.now()) {
      warnings.push(
        `[${bundleId}] Embedded provisioning profile expired on ${expirationDate.toISOString()}`,
      );
    }

    return warnings;
  });
