/**
 * Developer ID provisioning profiles for an Xcode build. Xcode refuses to
 * archive a target whose entitlements need a profile unless one is selected,
 * so before archiving the build learns each target's bundle id and
 * entitlements from `xcodebuild -showBuildSettings`, installs the profiles
 * where Xcode looks for them, and selects them per target in the (staged)
 * project — a command-line `PROVISIONING_PROFILE_SPECIFIER` would apply one
 * profile to every target.
 */
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { asRecord } from "@better-update/type-guards";
import { Effect } from "effect";

import { execFailureDetail, runTool } from "./exec-tool";
import { BuildFailedError } from "./exit-codes";
import { applyTargetSigning } from "./ios-codesign-pbxproj";
import { entitlementsNeedingProfile } from "./macos-code-inspect";
import { parsePlist } from "./plist";
import { xcodeProfileDirectories } from "./xcode-profile-dirs";
import { discoverSignedTargets } from "./xcode-targets";

import type { ProfileNeed, ResolvedProfile } from "../application/macos-provisioning";
import type { PlistObject } from "./plist";

export interface XcodeTarget {
  readonly targetName: string;
  readonly bundleId: string;
  /** The target's entitlements as written in its `CODE_SIGN_ENTITLEMENTS` file. */
  readonly entitlements: PlistObject | undefined;
}

const stringSetting = (settings: Record<string, unknown>, key: string): string | undefined => {
  const value = settings[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const readEntitlementsFile = (filePath: string) =>
  Effect.promise(async () => {
    try {
      return parsePlist(await readFile(filePath));
    } catch {
      return undefined;
    }
  });

/** Bundle-producing targets (apps, extensions, XPC services) the scheme builds. */
const BUNDLE_WRAPPERS = new Set(["app", "appex", "xpc", "systemextension"]);

/**
 * Every bundle target `scheme` builds in `configuration`, with its resolved
 * bundle id and entitlements.
 */
export const readXcodeTargets = (params: {
  readonly containerFlag: string;
  readonly containerPath: string;
  readonly scheme: string;
  readonly configuration: string;
  readonly env: Record<string, string>;
}) =>
  Effect.gen(function* () {
    const result = yield* runTool(
      "xcodebuild",
      [
        params.containerFlag,
        params.containerPath,
        "-scheme",
        params.scheme,
        "-configuration",
        params.configuration,
        "-destination",
        "generic/platform=macOS",
        "-showBuildSettings",
        "-json",
      ],
      params.env,
    );
    const parsed: unknown = yield* Effect.try({
      try: (): unknown => JSON.parse(result.stdout.slice(result.stdout.indexOf("["))),
      catch: () =>
        new BuildFailedError({
          step: "xcodebuild -showBuildSettings",
          exitCode: result.exitCode,
          message: `Could not read the scheme's build settings: ${execFailureDetail(result)}`,
        }),
    });
    const entries = Array.isArray(parsed) ? parsed : [];
    // eslint-disable-next-line unicorn/no-array-method-this-argument -- false positive: Effect.forEach(iterable, f) is not Array.prototype.forEach
    const targets = yield* Effect.forEach(entries, (entry) =>
      Effect.gen(function* () {
        const record = asRecord(entry);
        const settings = asRecord(record?.["buildSettings"]) ?? {};
        const targetName = typeof record?.["target"] === "string" ? record["target"] : undefined;
        const bundleId = stringSetting(settings, "PRODUCT_BUNDLE_IDENTIFIER");
        const wrapper = stringSetting(settings, "WRAPPER_EXTENSION");
        if (
          targetName === undefined ||
          bundleId === undefined ||
          wrapper === undefined ||
          !BUNDLE_WRAPPERS.has(wrapper)
        ) {
          return [];
        }
        const entitlementsSetting = stringSetting(settings, "CODE_SIGN_ENTITLEMENTS");
        const srcRoot = stringSetting(settings, "SRCROOT") ?? path.dirname(params.containerPath);
        const entitlements =
          entitlementsSetting === undefined
            ? undefined
            : yield* readEntitlementsFile(path.resolve(srcRoot, entitlementsSetting));
        return [{ targetName, bundleId, entitlements } satisfies XcodeTarget];
      }),
    );
    return targets.flat();
  });

const fileExists = async (filePath: string) => {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Install profiles where Xcode finds them for the scope of the build, removing
 * only the copies this build added.
 */
export const installXcodeProfiles = (
  profiles: readonly { readonly path: string; readonly uuid: string }[],
) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const { userData, mobileDevice } = yield* xcodeProfileDirectories;
      return yield* Effect.promise(async () => {
        const targets = profiles.flatMap((profile) =>
          [userData, mobileDevice].map((dir) => ({
            source: profile.path,
            dir,
            target: path.join(dir, `${profile.uuid}.provisionprofile`),
          })),
        );
        const added = await Promise.all(
          targets.map(async ({ source, dir, target }) => {
            if (await fileExists(target)) {
              return [];
            }
            await mkdir(dir, { recursive: true });
            await copyFile(source, target);
            return [target];
          }),
        );
        return added.flat();
      });
    }),
    (added) =>
      Effect.promise(async () => {
        await Promise.all(added.map(async (target) => rm(target, { force: true })));
      }),
  );

/**
 * Select each target's profile in the project: the profile name for targets
 * that need one, none for the others (so a profile the project names for
 * another kind of distribution is not picked up).
 */
export const selectXcodeProfiles = (params: {
  readonly projectDir: string;
  readonly configuration: string;
  readonly teamId: string;
  readonly identityName: string;
  readonly profileNamesByTarget: ReadonlyMap<string, string>;
}) =>
  Effect.gen(function* () {
    const targets = yield* discoverSignedTargets({
      iosDir: params.projectDir,
      configurationName: params.configuration,
    });
    yield* applyTargetSigning({
      iosDir: params.projectDir,
      entries: targets.map((target) => ({
        targetName: target.targetName,
        buildConfigurationUuids: target.buildConfigurationUuids,
        settings: {
          teamId: params.teamId,
          signingIdentity: params.identityName,
          // eslint-disable-next-line eslint-js/no-restricted-syntax -- an empty specifier is the setting's "no profile" value, not a missing one
          profileSpecifier: params.profileNamesByTarget.get(target.targetName) ?? "",
        },
      })),
    });
  });

/** Provisioning profiles for the bundles that need one, keyed by bundle id. */
export type ResolveProfiles<ProfileError, ProfileServices> = (
  needs: readonly ProfileNeed[],
) => Effect.Effect<ReadonlyMap<string, ResolvedProfile>, ProfileError, ProfileServices>;

/**
 * Resolve, install (for the enclosing scope) and select the profiles of the
 * targets that need one. An empty map — the usual case — leaves the project
 * untouched.
 */
export const prepareXcodeProfiles = <ProfileError, ProfileServices>(params: {
  readonly resolveProfiles: ResolveProfiles<ProfileError, ProfileServices>;
  readonly identity: { readonly teamId: string; readonly name: string };
  readonly macosDir: string;
  readonly container: { readonly flag: string; readonly containerPath: string };
  readonly scheme: string;
  readonly configuration: string;
  readonly env: Record<string, string>;
}) =>
  Effect.gen(function* () {
    const targets = yield* readXcodeTargets({
      containerFlag: params.container.flag,
      containerPath: params.container.containerPath,
      scheme: params.scheme,
      configuration: params.configuration,
      env: params.env,
    });
    const needing = targets.flatMap((target) => {
      const entitlements = entitlementsNeedingProfile(target.entitlements);
      return entitlements.length === 0 ? [] : [{ ...target, needed: entitlements }];
    });
    if (needing.length === 0) {
      return new Map<string, ResolvedProfile>();
    }
    const profiles = yield* params.resolveProfiles(
      needing.map((target) => ({ bundleId: target.bundleId, entitlements: target.needed })),
    );
    yield* installXcodeProfiles([...profiles.values()]);
    yield* selectXcodeProfiles({
      projectDir: params.macosDir,
      configuration: params.configuration,
      teamId: params.identity.teamId,
      identityName: params.identity.name,
      profileNamesByTarget: new Map(
        needing.flatMap((target) => {
          const profile = profiles.get(target.bundleId);
          return profile === undefined ? [] : [[target.targetName, profile.name] as const];
        }),
      ),
    });
    return profiles;
  });
