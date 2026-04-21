import path from "node:path";

import { Command, FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";

import type { CommandExecutor } from "@effect/platform";

import { parsePlist, parsePlistXml } from "./plist";

export interface IosValidationParams {
  readonly archivePath: string;
  readonly expectedBundleId: string;
  readonly expectedTeamId: string;
  readonly expectedProfileUuid: string;
}

export interface ValidationResult {
  readonly passed: boolean;
  readonly warnings: readonly string[];
}

/**
 * Validate an iOS build after xcodebuild completes. Checks:
 * 1. Bundle ID matches expected value
 * 2. Provisioning profile UUID matches
 * 3. Team ID matches
 *
 * All checks are non-blocking — returns warnings, never fails the build.
 */
export const validateIosBuild = (
  params: IosValidationParams,
): Effect.Effect<
  ValidationResult,
  never,
  CommandExecutor.CommandExecutor | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const appDir = yield* findAppDirectory(params.archivePath).pipe(
      Effect.catchAll(() => Effect.succeed(undefined)),
    );

    if (!appDir) {
      const warnings = ["Could not locate .app bundle in archive — skipping post-build validation"];
      return { passed: false, warnings };
    }

    const bundleWarning = yield* checkBundleId(appDir, params.expectedBundleId).pipe(
      Effect.catchAll(() => Effect.succeed(undefined)),
    );

    const profileWarnings = yield* checkEmbeddedProfile(
      appDir,
      params.expectedProfileUuid,
      params.expectedTeamId,
    ).pipe(Effect.catchAll(() => Effect.succeed([] as readonly string[])));

    const warnings: readonly string[] = [
      ...(bundleWarning ? [bundleWarning] : []),
      ...profileWarnings,
    ];

    if (warnings.length > 0) {
      yield* Console.warn("Post-build validation warnings:");
      for (const warning of warnings) {
        yield* Console.warn(`  - ${warning}`);
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

const checkBundleId = (
  appDir: string,
  expectedBundleId: string,
): Effect.Effect<string | undefined, unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const plistPath = path.join(appDir, "Info.plist");
    const data = yield* fs.readFile(plistPath);
    const parsed = parsePlist(Buffer.from(data));
    const actualBundleId = parsed["CFBundleIdentifier"];

    if (typeof actualBundleId === "string" && actualBundleId !== expectedBundleId) {
      return `Bundle ID mismatch: expected "${expectedBundleId}", got "${actualBundleId}"`;
    }
    return undefined;
  });

const checkEmbeddedProfile = (
  appDir: string,
  expectedUuid: string,
  expectedTeamId: string,
): Effect.Effect<
  readonly string[],
  unknown,
  CommandExecutor.CommandExecutor | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const warnings: string[] = [];
    const profilePath = path.join(appDir, "embedded.mobileprovision");

    // Use security cms to decrypt the profile (it's CMS-signed)
    const plistXml = yield* Command.string(
      Command.make("security", "cms", "-D", "-i", profilePath),
    );

    const parsed = parsePlistXml(plistXml);

    const actualUuid = parsed["UUID"];
    if (typeof actualUuid === "string" && actualUuid !== expectedUuid) {
      warnings.push(`Profile UUID mismatch: expected "${expectedUuid}", got "${actualUuid}"`);
    }

    const teamIdentifiers = parsed["TeamIdentifier"];
    if (Array.isArray(teamIdentifiers)) {
      // eslint-disable-next-line typescript/no-unsafe-assignment -- @expo/plist types array entries as any; narrowed via typeof check below
      const [actualTeamId] = teamIdentifiers;
      if (typeof actualTeamId === "string" && actualTeamId !== expectedTeamId) {
        warnings.push(`Team ID mismatch: expected "${expectedTeamId}", got "${actualTeamId}"`);
      }
    }

    // Check expiration
    const expirationDate = parsed["ExpirationDate"];
    if (expirationDate instanceof Date && expirationDate.getTime() < Date.now()) {
      warnings.push(`Embedded provisioning profile expired on ${expirationDate.toISOString()}`);
    }

    return warnings;
  });
