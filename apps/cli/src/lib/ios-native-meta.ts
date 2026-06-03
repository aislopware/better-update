import path from "node:path";

import { compact } from "@better-update/type-guards";
import { Effect } from "effect";

import type { FileSystem } from "@effect/platform";
import type { PBXNativeTarget, XcodeProject } from "xcode";

import { findXcodeProjectDir, parseProject, unquote } from "./xcode-targets";

import type { XcodeProjectError } from "./exit-codes";

const APPLICATION_PRODUCT_TYPE = "com.apple.product-type.application";

export interface IosNativeMeta {
  readonly bundleId?: string;
  /** `MARKETING_VERSION` — the user-facing version (CFBundleShortVersionString). */
  readonly marketingVersion?: string;
  /** `CURRENT_PROJECT_VERSION` — the build number (CFBundleVersion). */
  readonly currentProjectVersion?: string;
}

/**
 * A build setting that is an unresolved reference (`$(MARKETING_VERSION)`) or a
 * variable interpolation tells us nothing concrete — treat it as absent so the
 * profile `metaOverride` can supply a real value.
 */
const concreteSetting = (raw: unknown): string | undefined => {
  // The `xcode` parser returns unquoted numeric tokens (e.g. `CURRENT_PROJECT_VERSION = 88`)
  // as JS numbers; quoted/string values come back verbatim.
  if (typeof raw === "number") {
    return String(raw);
  }
  if (typeof raw !== "string") {
    return undefined;
  }
  const value = unquote(raw);
  return value.length === 0 || value.includes("$(") ? undefined : value;
};

const findApplicationTarget = (project: XcodeProject): PBXNativeTarget | undefined => {
  const nativeTargets = project.pbxNativeTargetSection();
  for (const [uuid, entry] of Object.entries(nativeTargets)) {
    if (uuid.endsWith("_comment") || typeof entry === "string") {
      continue; // eslint-disable-line no-continue -- skip pbxproj `_comment` sibling keys and stringified comments
    }
    if (unquote(entry.productType) === APPLICATION_PRODUCT_TYPE) {
      return entry;
    }
  }
  return undefined;
};

const configUuidForName = (
  project: XcodeProject,
  target: PBXNativeTarget,
  configurationName: string,
): string | undefined => {
  const configList = project.pbxXCConfigurationList()[target.buildConfigurationList];
  if (!configList || typeof configList === "string") {
    return undefined;
  }
  const buildConfigSection = project.pbxXCBuildConfigurationSection();
  return configList.buildConfigurations
    .map((entry) => entry.value)
    .find((uuid) => {
      const cfg = buildConfigSection[uuid];
      return (
        cfg !== undefined && typeof cfg !== "string" && unquote(cfg.name) === configurationName
      );
    });
};

/**
 * Read app metadata (bundle id, marketing version, build number) for the main
 * application target of the single `.xcodeproj` under `iosDir`, for a given build
 * configuration. Used for non-Expo (bare/native) projects where there is no
 * `app.json`. Missing or unresolved settings come back `undefined` so the caller
 * can fall back to profile `metaOverride`.
 */
export const readIosNativeMeta = (params: {
  readonly iosDir: string;
  readonly configurationName: string;
}): Effect.Effect<IosNativeMeta, XcodeProjectError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const projectDir = yield* findXcodeProjectDir(params.iosDir);
    const project = yield* parseProject(path.join(projectDir, "project.pbxproj"));

    const target = findApplicationTarget(project);
    if (target === undefined) {
      return {};
    }
    const configUuid = configUuidForName(project, target, params.configurationName);
    if (configUuid === undefined) {
      return {};
    }
    const cfg = project.pbxXCBuildConfigurationSection()[configUuid];
    if (cfg === undefined || typeof cfg === "string") {
      return {};
    }
    const settings = cfg.buildSettings;
    return compact({
      bundleId: concreteSetting(settings["PRODUCT_BUNDLE_IDENTIFIER"]),
      marketingVersion: concreteSetting(settings["MARKETING_VERSION"]),
      currentProjectVersion: concreteSetting(settings["CURRENT_PROJECT_VERSION"]),
    });
  });
