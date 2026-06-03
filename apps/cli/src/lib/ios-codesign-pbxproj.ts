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

export interface TargetSigningEntry {
  /** For diagnostics — does not affect what is written. */
  readonly targetName: string;
  /** UUIDs of XCBuildConfiguration entries whose buildSettings should be mutated. */
  readonly buildConfigurationUuids: readonly string[];
  readonly settings: TargetSigningSettings;
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

const SDK_CONDITIONAL_IDENTITY_KEYS = [
  '"CODE_SIGN_IDENTITY[sdk=iphoneos*]"',
  "CODE_SIGN_IDENTITY[sdk=iphoneos*]",
] as const;

const mutateConfig = (
  project: XcodeProject,
  configUuid: string,
  settings: TargetSigningSettings,
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
  return true;
};

/**
 * Write `CODE_SIGN_STYLE=Manual`, `DEVELOPMENT_TEAM`, `CODE_SIGN_IDENTITY`, and
 * `PROVISIONING_PROFILE_SPECIFIER` into the specified XCBuildConfiguration
 * entries of the project under `iosDir`, then serialize back to disk.
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
        const mutated = mutateConfig(project, configUuid, entry.settings);
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
