import path from "node:path";

import { Command, CommandExecutor, FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";

import { inspectKeystore, validateKeystoreAlias } from "./keystore-parser";
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
    const warnings: string[] = [];

    // Find the .app directory inside the archive
    const appDir = yield* findAppDirectory(params.archivePath).pipe(
      Effect.catchAll(() => Effect.succeed(undefined)),
    );

    if (!appDir) {
      warnings.push("Could not locate .app bundle in archive — skipping post-build validation");
      return { passed: warnings.length === 0, warnings };
    }

    // 1. Check bundle ID from Info.plist
    yield* checkBundleId(appDir, params.expectedBundleId).pipe(
      Effect.tap((w) => (w ? Effect.sync(() => warnings.push(w)) : Effect.void)),
      Effect.catchAll(() => Effect.void),
    );

    // 2. Check embedded provisioning profile
    yield* checkEmbeddedProfile(appDir, params.expectedProfileUuid, params.expectedTeamId).pipe(
      Effect.tap((ws) => Effect.sync(() => warnings.push(...ws))),
      Effect.catchAll(() => Effect.void),
    );

    if (warnings.length > 0) {
      yield* Console.warn("Post-build validation warnings:");
      for (const w of warnings) {
        yield* Console.warn(`  - ${w}`);
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
    const appEntry = entries.find((e) => e.endsWith(".app"));
    if (!appEntry) return yield* Effect.fail("No .app found");
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
    if (Array.isArray(teamIdentifiers) && typeof teamIdentifiers[0] === "string") {
      const actualTeamId = teamIdentifiers[0] as string;
      if (actualTeamId !== expectedTeamId) {
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

/**
 * Validate an Android keystore before build. Checks that the expected alias exists.
 * Non-blocking — logs warnings, never fails.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- wired into Android build in follow-up
const _validateAndroidKeystore = (params: {
  readonly keystoreData: Buffer;
  readonly keystorePassword: string;
  readonly expectedAlias: string;
}): Effect.Effect<ValidationResult> =>
  Effect.gen(function* () {
    const warnings: string[] = [];

    const info = yield* inspectKeystore({
      data: params.keystoreData,
      password: params.keystorePassword,
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

    if (!info) {
      warnings.push("Could not parse keystore for validation");
      return { passed: false, warnings };
    }

    const aliasWarning = validateKeystoreAlias(info, params.expectedAlias);
    if (aliasWarning) {
      warnings.push(aliasWarning);
      yield* Console.warn(aliasWarning);
    }

    return { passed: warnings.length === 0, warnings };
  });
