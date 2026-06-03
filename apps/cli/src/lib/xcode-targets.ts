import path from "node:path";

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import type { PBXNativeTarget, XcodeProject } from "xcode";

import { XcodeProjectError } from "./exit-codes";

/** Product types whose targets require code-signing with a provisioning profile. */
export const SIGNED_PRODUCT_TYPES = new Set<string>([
  "com.apple.product-type.application",
  "com.apple.product-type.app-extension",
  "com.apple.product-type.messages-extension",
  "com.apple.product-type.tv-app-extension",
  "com.apple.product-type.watchapp2",
  "com.apple.product-type.watchkit2-extension",
]);

export interface DiscoveredTarget {
  readonly targetName: string;
  readonly bundleId: string;
  readonly productType: string;
  /** UUIDs of all build configurations that contain this target's settings (one per scheme config). */
  readonly buildConfigurationUuids: readonly string[];
}

export interface DiscoverSignedTargetsOptions {
  readonly iosDir: string;
  readonly configurationName: string;
}

interface XcodeModule {
  readonly project: (projectPath: string) => XcodeProject;
}

const loadXcodeModule = (): XcodeModule =>
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- CJS require returns `any`; narrow at the xcode package boundary
  require("xcode") as XcodeModule;

/**
 * Strip surrounding quotes from a pbxproj string value. `xcode` returns values
 * verbatim from the project file, so identifiers like productType are usually
 * wrapped in double quotes (e.g. `"com.apple.product-type.application"`).
 */
export const unquote = (value: string): string =>
  value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;

export const findXcodeProjectDir = (
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
        message: `No .xcodeproj directory found under ${iosDir}. Did "expo prebuild" run?`,
      });
    }
    return path.join(iosDir, projectDir);
  });

export const parseProject = (pbxprojPath: string): Effect.Effect<XcodeProject, XcodeProjectError> =>
  Effect.try({
    try: () => loadXcodeModule().project(pbxprojPath).parseSync(),
    catch: (cause) =>
      new XcodeProjectError({
        message: `Failed to parse ${pbxprojPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });

const collectConfigUuidsForTarget = (
  project: XcodeProject,
  target: PBXNativeTarget,
  configurationName: string,
): readonly string[] => {
  const configListSection = project.pbxXCConfigurationList();
  const configList = configListSection[target.buildConfigurationList];
  if (!configList || typeof configList === "string") {
    return [];
  }
  const buildConfigSection = project.pbxXCBuildConfigurationSection();
  return configList.buildConfigurations
    .map((entry) => entry.value)
    .filter((uuid) => {
      const cfg = buildConfigSection[uuid];
      if (!cfg || typeof cfg === "string") {
        return false;
      }
      return unquote(cfg.name) === configurationName;
    });
};

const extractBundleIdForConfig = (
  project: XcodeProject,
  configUuid: string,
): string | undefined => {
  const buildConfigSection = project.pbxXCBuildConfigurationSection();
  const cfg = buildConfigSection[configUuid];
  if (!cfg || typeof cfg === "string") {
    return undefined;
  }
  const raw = cfg.buildSettings["PRODUCT_BUNDLE_IDENTIFIER"];
  if (typeof raw !== "string") {
    return undefined;
  }
  return unquote(raw);
};

const collectSignedTargets = (
  project: XcodeProject,
  pbxprojPath: string,
  configurationName: string,
): Effect.Effect<readonly DiscoveredTarget[], XcodeProjectError> =>
  Effect.gen(function* () {
    const results: DiscoveredTarget[] = [];
    const nativeTargets = project.pbxNativeTargetSection();
    for (const [uuid, entry] of Object.entries(nativeTargets)) {
      const isCommentKey = uuid.endsWith("_comment");
      const isStringEntry = typeof entry === "string";
      if (isCommentKey || isStringEntry) {
        continue; // eslint-disable-line no-continue -- skip pbxproj `_comment` sibling keys and stringified comments; restructuring to filter() loses the typeof-narrowing
      }
      const productType = unquote(entry.productType);
      if (!SIGNED_PRODUCT_TYPES.has(productType)) {
        continue; // eslint-disable-line no-continue -- non-signed product types (pods, static libs) are intentionally skipped
      }

      const configUuids = collectConfigUuidsForTarget(project, entry, configurationName);
      const [firstConfigUuid] = configUuids;
      if (!firstConfigUuid) {
        return yield* new XcodeProjectError({
          message: `Target "${unquote(entry.name)}" has no "${configurationName}" build configuration in ${pbxprojPath}.`,
        });
      }

      const bundleId = extractBundleIdForConfig(project, firstConfigUuid);
      if (!bundleId) {
        return yield* new XcodeProjectError({
          message: `Target "${unquote(entry.name)}" is missing PRODUCT_BUNDLE_IDENTIFIER in the "${configurationName}" configuration.`,
        });
      }

      results.push({
        targetName: unquote(entry.name),
        bundleId,
        productType,
        buildConfigurationUuids: configUuids,
      });
    }
    return results;
  });

/**
 * Enumerate code-signed native targets (main app + extensions) declared in the
 * single `.xcodeproj` under `iosDir`, restricted to a given build configuration
 * (e.g. "Release"). Pod targets and other library product types are excluded.
 *
 * The returned `buildConfigurationUuids` list is the set of XCBuildConfiguration
 * UUIDs that belong to this target *and* match `configurationName` — the
 * per-target signing mutator writes settings into exactly those configurations.
 */
export const discoverSignedTargets = (
  options: DiscoverSignedTargetsOptions,
): Effect.Effect<readonly DiscoveredTarget[], XcodeProjectError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const projectDir = yield* findXcodeProjectDir(options.iosDir);
    const pbxprojPath = path.join(projectDir, "project.pbxproj");
    const project = yield* parseProject(pbxprojPath);
    const results = yield* collectSignedTargets(project, pbxprojPath, options.configurationName);

    if (results.length === 0) {
      return yield* new XcodeProjectError({
        message: `No signed native targets found in ${pbxprojPath} for configuration "${options.configurationName}".`,
      });
    }

    return results;
  });
