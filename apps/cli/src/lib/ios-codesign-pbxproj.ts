import path from "node:path";

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import type { XcodeProject } from "xcode";

import { XcodeProjectError } from "./exit-codes";

export interface TargetSigningSettings {
  readonly teamId: string;
  readonly signingIdentity: string;
  readonly profileSpecifier: string;
}

/**
 * App-version build settings to materialize into a target's configuration(s).
 * Only used for non-Expo projects whose eas.json profile carries an explicit
 * version / buildNumber override — Expo writes these via `expo prebuild`, so
 * the Expo path leaves this undefined. Each field is optional so a profile that
 * sets only one of version / buildNumber writes only that one.
 */
export interface TargetVersionSettings {
  /** Maps to `MARKETING_VERSION` (the user-facing version, e.g. "6.0.4"). */
  readonly marketingVersion?: string;
  /** Maps to `CURRENT_PROJECT_VERSION` (the build number, e.g. "17"). */
  readonly currentProjectVersion?: string;
}

export interface TargetSigningEntry {
  /** For diagnostics — does not affect what is written. */
  readonly targetName: string;
  /** UUIDs of XCBuildConfiguration entries whose buildSettings should be mutated. */
  readonly buildConfigurationUuids: readonly string[];
  readonly settings: TargetSigningSettings;
  /**
   * Optional version settings written into the same configuration(s) as signing.
   * This layer is policy-agnostic — it writes them onto whichever entries carry
   * them. The caller decides which targets receive a version (see
   * `buildSigningEntries`, which attaches it to every signed target so a bundled
   * extension's version matches the host app, per App Store validation).
   */
  readonly versions?: TargetVersionSettings;
}

export interface ApplyTargetSigningOptions {
  readonly iosDir: string;
  readonly entries: readonly TargetSigningEntry[];
}

interface XcodeModule {
  readonly project: (projectPath: string) => XcodeProject;
}

const loadXcodeModule = (): XcodeModule =>
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- CJS require returns `any`; narrow at the xcode package boundary
  require("xcode") as XcodeModule;

const findXcodeProjectDir = (
  iosDir: string,
): Effect.Effect<string, XcodeProjectError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const entries = yield* fs.readDirectory(iosDir).pipe(
      Effect.mapError(
        (cause) =>
          new XcodeProjectError({
            message: `Failed to read ${iosDir}: ${String(cause)}`,
          }),
      ),
    );
    const projectDir = entries.find((entry) => entry.endsWith(".xcodeproj"));
    if (!projectDir) {
      return yield* new XcodeProjectError({
        message: `No .xcodeproj directory found under ${iosDir}.`,
      });
    }
    return path.join(iosDir, projectDir);
  });

const parseProject = (pbxprojPath: string): Effect.Effect<XcodeProject, XcodeProjectError> =>
  Effect.try({
    try: () => loadXcodeModule().project(pbxprojPath).parseSync(),
    catch: (cause) =>
      new XcodeProjectError({
        message: `Failed to parse ${pbxprojPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });

/**
 * Always wrap a value in double quotes for safe pbxproj serialization. The
 * `xcode` writer emits values verbatim (e.g. `KEY = %s;`), so any string with
 * spaces, brackets or non-identifier characters needs explicit quoting.
 */
const quote = (value: string): string => `"${value.replaceAll('"', String.raw`\"`)}"`;

/**
 * Version values (e.g. `6.0.4`, `17`) are normally emitted unquoted in pbxproj.
 * Keep them bare when they are a safe token to minimize diff noise versus the
 * committed project; fall back to quoting only for unusual values.
 */
const SAFE_PBX_TOKEN = /^[A-Za-z0-9._-]+$/u;
const pbxValue = (value: string): string => (SAFE_PBX_TOKEN.test(value) ? value : quote(value));

const SDK_CONDITIONAL_IDENTITY_KEYS = [
  '"CODE_SIGN_IDENTITY[sdk=iphoneos*]"',
  "CODE_SIGN_IDENTITY[sdk=iphoneos*]",
] as const;

const mutateConfig = (
  project: XcodeProject,
  configUuid: string,
  settings: TargetSigningSettings,
  versions: TargetVersionSettings | undefined,
): boolean => {
  const buildConfigSection = project.pbxXCBuildConfigurationSection();
  const cfg = buildConfigSection[configUuid];
  if (!cfg || typeof cfg === "string") {
    return false;
  }
  // Apply our four manual-signing settings. Pre-quote so the writer emits valid
  // pbxproj syntax for values that may contain spaces.
  cfg.buildSettings["CODE_SIGN_STYLE"] = "Manual";
  cfg.buildSettings["DEVELOPMENT_TEAM"] = quote(settings.teamId);
  cfg.buildSettings["CODE_SIGN_IDENTITY"] = quote(settings.signingIdentity);
  cfg.buildSettings["PROVISIONING_PROFILE_SPECIFIER"] = quote(settings.profileSpecifier);

  // Remove legacy / SDK-conditional keys that would override our base values.
  delete cfg.buildSettings["PROVISIONING_PROFILE"];
  for (const key of SDK_CONDITIONAL_IDENTITY_KEYS) {
    // eslint-disable-next-line typescript/no-dynamic-delete -- delete optional Xcode-emitted SDK-conditional CODE_SIGN_IDENTITY variants if present
    delete cfg.buildSettings[key];
  }

  // Materialize the eas.json version override into the target's build settings
  // (non-Expo only — see TargetVersionSettings). Setting them at target scope
  // overrides any project-level inheritance, so xcodebuild archives this value.
  if (versions?.marketingVersion !== undefined) {
    cfg.buildSettings["MARKETING_VERSION"] = pbxValue(versions.marketingVersion);
  }
  if (versions?.currentProjectVersion !== undefined) {
    cfg.buildSettings["CURRENT_PROJECT_VERSION"] = pbxValue(versions.currentProjectVersion);
  }
  return true;
};

/**
 * Write `CODE_SIGN_STYLE=Manual`, `DEVELOPMENT_TEAM`, `CODE_SIGN_IDENTITY`, and
 * `PROVISIONING_PROFILE_SPECIFIER` into the specified XCBuildConfiguration
 * entries of the project under `iosDir`, then serialize back to disk. When an
 * entry carries `versions`, `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` are
 * written into the same configuration(s) in the one pass.
 *
 * Only mutates the main app project — `Pods.xcodeproj` is left untouched. The
 * caller is responsible for ensuring each entry's `buildConfigurationUuids`
 * only includes configurations that belong to a signed target (see
 * `discoverSignedTargets`).
 */
export const applyTargetSigning = (
  options: ApplyTargetSigningOptions,
): Effect.Effect<void, XcodeProjectError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const projectDir = yield* findXcodeProjectDir(options.iosDir);
    const pbxprojPath = path.join(projectDir, "project.pbxproj");
    const project = yield* parseProject(pbxprojPath);

    for (const entry of options.entries) {
      for (const configUuid of entry.buildConfigurationUuids) {
        const mutated = mutateConfig(project, configUuid, entry.settings, entry.versions);
        if (!mutated) {
          return yield* new XcodeProjectError({
            message: `Build configuration ${configUuid} not found for target "${entry.targetName}" in ${pbxprojPath}.`,
          });
        }
      }
    }

    const serialized = yield* Effect.try({
      try: () => project.writeSync(),
      catch: (cause) =>
        new XcodeProjectError({
          message: `Failed to serialize ${pbxprojPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });

    yield* fs.writeFileString(pbxprojPath, serialized).pipe(
      Effect.mapError(
        (cause) =>
          new XcodeProjectError({
            message: `Failed to write ${pbxprojPath}: ${String(cause)}`,
          }),
      ),
    );
  });
