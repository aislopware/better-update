import type { TargetSigningEntry, TargetVersionSettings } from "./ios-codesign-pbxproj";
import type { DiscoveredTarget } from "./xcode-targets";

/** A discovered+installed target, reduced to the fields needed to render an entry. */
export interface SigningTargetInstall {
  readonly target: DiscoveredTarget;
  readonly installed: { readonly teamId: string; readonly name: string };
}

/**
 * Render the pbxproj signing entries for every installed target. When
 * `nativeVersion` is provided it is attached to ALL signed targets (app +
 * extensions): App Store validation rejects a bundled extension whose
 * CFBundleVersion / CFBundleShortVersionString differs from the host app, so the
 * version must move on every target together (matches `expo prebuild` and the
 * prior per-repo sync-version workaround).
 *
 * Pure and dependency-free so the build pipeline and its tests share one source
 * of truth for the entry shape without pulling in the credentials stack.
 */
export const buildSigningEntries = (params: {
  readonly installedTargets: readonly SigningTargetInstall[];
  readonly signingIdentity: string;
  readonly nativeVersion?: TargetVersionSettings | undefined;
}): readonly TargetSigningEntry[] =>
  params.installedTargets.map(({ target, installed }) => ({
    targetName: target.targetName,
    buildConfigurationUuids: target.buildConfigurationUuids,
    settings: {
      teamId: installed.teamId,
      signingIdentity: params.signingIdentity,
      profileSpecifier: installed.name,
    },
    ...(params.nativeVersion ? { versions: params.nativeVersion } : {}),
  }));
