/**
 * Developer ID code-signing for a macOS `.app` bundle: discover every nested
 * code item (frameworks, helper apps, XPC services, dylibs, sidecar
 * executables), sign them inside-out with the hardened runtime + a secure
 * timestamp (both required by notarization), then sign and verify the outer
 * bundle. This is the walk `codesign --deep` used to approximate — done
 * explicitly because `--deep` is deprecated, misses loose Mach-Os, and applies
 * one entitlement set to everything.
 *
 * Re-signing keeps what the build put there: each item is signed with its own
 * current entitlements (minus `get-task-allow`), and identifiers are only
 * assigned to code that has no real identity yet (ad-hoc or linker-signed, as
 * cargo/ld emit). A plain `codesign --force` would silently drop both.
 */
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Effect } from "effect";

import { execFailureDetail, runTool } from "./exec-tool";
import { CodesignError } from "./exit-codes";
import {
  collectNestedCode,
  looseCodeIdentifier,
  orderForSigning,
  readBundleInfo,
} from "./macos-code-discovery";
import {
  distributionEntitlements,
  hasRealIdentity,
  inspectSignature,
  readEntitlements,
} from "./macos-code-inspect";
import { buildPlistXml, parsePlist } from "./plist";

import type { NestedCodeItem } from "./macos-code-discovery";
import type { PlistObject } from "./plist";

/** A Developer ID provisioning profile on disk, for the bundle it is issued to. */
export interface EmbeddedProfile {
  readonly path: string;
  readonly teamId: string;
}

export interface SignMacosAppOptions {
  readonly appPath: string;
  /** Keychain identity string, e.g. `Developer ID Application: Acme (TEAMID)`. */
  readonly identity: string;
  /** Ephemeral keychain holding the imported `.p12` (from acquireKeychain). */
  readonly keychainPath: string;
  /**
   * Entitlements plist for the OUTER bundle (or the bare binary). Replaces its
   * current entitlements; when omitted they are preserved.
   */
  readonly entitlementsPath?: string | undefined;
  /** Private scratch dir for the per-item entitlement files. */
  readonly workDir: string;
  /**
   * Developer ID profiles by bundle id. A bundle with one gets it embedded as
   * `Contents/embedded.provisionprofile` and claims the app id + team the
   * profile authorizes; the others are signed without.
   */
  readonly provisioningProfiles?: ReadonlyMap<string, EmbeddedProfile> | undefined;
}

/**
 * What a bundle carrying a profile must claim besides its own entitlements:
 * the app id and team the profile is issued to (Xcode adds both when it signs
 * with a profile; codesign does not).
 */
export const profileIdentityEntitlements = (bundleId: string, teamId: string): PlistObject => ({
  "com.apple.application-identifier": `${teamId}.${bundleId}`,
  "com.apple.developer.team-identifier": teamId,
});

export interface SignMacosAppResult {
  /** Nested items that received their own signature, inside-out order. */
  readonly signedNested: readonly string[];
}

const codesignOrFail = (args: readonly string[], target: string) =>
  Effect.gen(function* () {
    const result = yield* runTool("codesign", args);
    if (result.exitCode !== 0) {
      return yield* new CodesignError({
        message: `codesign failed for ${target}: ${execFailureDetail(result)}`,
      });
    }
    return undefined;
  });

const writeEntitlementsFile = (
  entitlements: PlistObject | undefined,
  workDir: string,
  index: number,
) =>
  Effect.gen(function* () {
    if (entitlements === undefined) {
      return undefined;
    }
    const filePath = path.join(workDir, `entitlements-${index}.plist`);
    yield* Effect.promise(async () => writeFile(filePath, buildPlistXml(entitlements), "utf8"));
    return filePath;
  });

/**
 * Write `target`'s current entitlements (minus `get-task-allow`), plus
 * `extra`, to a scratch plist so the re-sign keeps them. `undefined` when
 * there are none.
 */
const preservedEntitlementsFile = (
  target: string,
  workDir: string,
  index: number,
  extra?: PlistObject,
) =>
  Effect.gen(function* () {
    const kept = distributionEntitlements(yield* readEntitlements(target));
    return yield* writeEntitlementsFile(
      kept === undefined && extra === undefined ? undefined : { ...kept, ...extra },
      workDir,
      index,
    );
  });

/** Embed `bundleId`'s profile, returning the entitlements it requires (none without one). */
const embedProfile = (
  options: SignMacosAppOptions,
  bundlePath: string,
  bundleId: string | undefined,
) =>
  Effect.gen(function* () {
    const profile =
      bundleId === undefined ? undefined : options.provisioningProfiles?.get(bundleId);
    if (bundleId === undefined || profile === undefined) {
      return undefined;
    }
    yield* Effect.promise(async () =>
      copyFile(profile.path, path.join(bundlePath, "Contents", "embedded.provisionprofile")),
    );
    return profileIdentityEntitlements(bundleId, profile.teamId);
  });

/** The caller's entitlements for the outer bundle, with what its profile requires. */
const outerEntitlementsFile = (options: SignMacosAppOptions, extra: PlistObject | undefined) =>
  Effect.gen(function* () {
    const { entitlementsPath } = options;
    if (entitlementsPath === undefined) {
      return yield* preservedEntitlementsFile(options.appPath, options.workDir, 0, extra);
    }
    if (extra === undefined) {
      return entitlementsPath;
    }
    const given = yield* Effect.promise(async () => parsePlist(await readFile(entitlementsPath)));
    return yield* writeEntitlementsFile({ ...given, ...extra }, options.workDir, 0);
  });

interface SignItem {
  readonly target: string;
  readonly entitlementsPath: string | undefined;
  readonly identifier: string | undefined;
}

const signItem = (options: SignMacosAppOptions, item: SignItem) =>
  codesignOrFail(
    [
      "--force",
      "--timestamp",
      "--options",
      "runtime",
      "--sign",
      options.identity,
      "--keychain",
      options.keychainPath,
      ...(item.identifier === undefined ? [] : ["--identifier", item.identifier]),
      ...(item.entitlementsPath === undefined ? [] : ["--entitlements", item.entitlementsPath]),
      item.target,
    ],
    item.target,
  );

/**
 * Identifier for a loose code file: keep a real one, otherwise derive
 * `<owner bundle id>.<file name>` — codesign would otherwise fall back to the
 * bare file name (or the linker's hash-suffixed name).
 */
const identifierFor = (item: NestedCodeItem, ownerBundleId: string | undefined) =>
  Effect.gen(function* () {
    if (item.kind === "bundle" || ownerBundleId === undefined) {
      return undefined;
    }
    const signature = yield* inspectSignature(item.path);
    return hasRealIdentity(signature) ? undefined : looseCodeIdentifier(ownerBundleId, item.path);
  });

const verifyOrFail = (target: string, deep: boolean) =>
  Effect.gen(function* () {
    const verify = yield* runTool("codesign", [
      "--verify",
      ...(deep ? ["--deep"] : []),
      "--strict",
      "--verbose=2",
      target,
    ]);
    if (verify.exitCode !== 0) {
      return yield* new CodesignError({
        message: `Signature verification failed: ${execFailureDetail(verify)}`,
      });
    }
    return undefined;
  });

/**
 * Sign a single Mach-O (a bare CLI tool / helper binary outside a bundle) and
 * verify it. `--entitlements` replaces its entitlements; otherwise they are
 * preserved.
 */
export const signMacosFile = (options: SignMacosAppOptions) =>
  Effect.gen(function* () {
    const entitlementsPath =
      options.entitlementsPath ??
      (yield* preservedEntitlementsFile(options.appPath, options.workDir, 0));
    yield* signItem(options, { target: options.appPath, entitlementsPath, identifier: undefined });
    yield* verifyOrFail(options.appPath, false);
    return { signedNested: [] } satisfies SignMacosAppResult;
  });

/**
 * Sign the whole bundle inside-out, then verify with `codesign --verify --deep
 * --strict`. Every bundle's main executable (the outer one's included) is left
 * to its bundle's signature; every other Mach-O — sidecars directly under
 * `Contents/MacOS` included — gets its own. Fails with {@link CodesignError}
 * carrying the first failing target's codesign output.
 */
export const signMacosApp = (options: SignMacosAppOptions) =>
  Effect.gen(function* () {
    const outer = yield* readBundleInfo(options.appPath);
    const nested = yield* collectNestedCode(options.appPath);
    const bundleInfos = yield* Effect.forEach(
      nested.filter((item) => item.kind === "bundle"),
      (item) =>
        readBundleInfo(item.path).pipe(Effect.map((info) => ({ ...info, path: item.path }))),
    );
    const bundleIds = new Map(bundleInfos.map((info) => [info.path, info.bundleId]));
    const mainExecutables = new Set(
      [outer, ...bundleInfos]
        .map((info) => info.mainExecutable)
        .filter((value): value is string => value !== undefined),
    );
    const ordered = orderForSigning(nested.filter((item) => !mainExecutables.has(item.path)));

    yield* Effect.forEach(
      ordered,
      (item, index) =>
        Effect.gen(function* () {
          // Library code takes no entitlements (Apple: "Don't apply
          // entitlements to library code"); executables and executable
          // bundles keep their own.
          const carriesEntitlements =
            item.kind === "executable" ||
            (item.kind === "bundle" && !item.path.toLowerCase().endsWith(".framework"));
          const required = carriesEntitlements
            ? yield* embedProfile(options, item.path, bundleIds.get(item.path))
            : undefined;
          const entitlementsPath = carriesEntitlements
            ? yield* preservedEntitlementsFile(item.path, options.workDir, index + 1, required)
            : undefined;
          const identifier = yield* identifierFor(item, outer.bundleId);
          yield* signItem(options, { target: item.path, entitlementsPath, identifier });
        }),
      { discard: true },
    );

    const outerEntitlements = yield* outerEntitlementsFile(
      options,
      yield* embedProfile(options, options.appPath, outer.bundleId),
    );
    yield* signItem(options, {
      target: options.appPath,
      entitlementsPath: outerEntitlements,
      identifier: undefined,
    });
    yield* verifyOrFail(options.appPath, true);
    return { signedNested: ordered.map((item) => item.path) } satisfies SignMacosAppResult;
  });
