import { Effect } from "effect";

import {
  ensureIosCredentials,
  makeIosSetupSession,
} from "../../application/credentials-interactive";
import { downloadIosCredentials } from "../../lib/credentials-downloader";
import { loadLocalIosCredentials } from "../../lib/local-credentials";

import type { CredentialsSource, IosProfile } from "../../lib/build-profile";
import type { IosBuildStrategy } from "../../lib/build-strategy";
import type { CustomCommandSpec } from "../../lib/eas-config";
import type { TargetVersionSettings } from "../../lib/ios-codesign-pbxproj";
import type { PackageManager } from "../../lib/project-staging";
import type { DiscoveredTarget } from "../../lib/xcode-targets";
import type { ApiClient } from "../../services/api-client";

export interface RunIosBuildInput {
  readonly api: ApiClient;
  readonly tempDir: string;
  readonly projectRoot: string;
  readonly iosProfile: IosProfile;
  readonly bundleId: string;
  readonly envVars: Record<string, string>;
  readonly projectId: string;
  readonly credentialsSource: CredentialsSource;
  /** How to produce the artifact (prebuild+xcodebuild / xcodebuild / custom). */
  readonly strategy: IosBuildStrategy;
  /** Custom build command, required when `strategy === "custom"`. */
  readonly customCommand?: CustomCommandSpec;
  /** Package manager of the staged workspace — used to run lifecycle hooks. */
  readonly packageManager: PackageManager;
  readonly rawOutput?: boolean | undefined;
  readonly freezeCredentials?: boolean | undefined;
  /** OTA channel baked into Expo.plist before the archive; undefined skips injection. */
  readonly updateChannel?: string | undefined;
  /**
   * Version build settings to write into the signed targets' pbxproj config(s)
   * alongside signing (app + extensions, so bundled extension versions match the
   * host app). Set by non-Expo callers when eas.json carries an explicit
   * version / buildNumber override; undefined leaves the native version as-is.
   */
  readonly nativeVersion?: TargetVersionSettings | undefined;
}

/**
 * Ensure every signed target has credentials, one target at a time: all bundles
 * (main + extensions) need setup in the same session; one setup session so the
 * shared answers (setup path, cert, ASC key) are asked once, not per target.
 */
export const ensurePerTargetCredentials = (params: {
  readonly api: ApiClient;
  readonly projectId: string;
  readonly distribution: IosProfile["distribution"];
  readonly signedTargets: readonly DiscoveredTarget[];
  readonly freezeCredentials: boolean;
}) =>
  Effect.gen(function* () {
    const setupSession = yield* makeIosSetupSession;
    yield* Effect.forEach(
      params.signedTargets,
      (target) =>
        ensureIosCredentials(
          params.api,
          {
            projectId: params.projectId,
            bundleIdentifier: target.bundleId,
            distribution: params.distribution,
          },
          { freezeCredentials: params.freezeCredentials, setupSession },
        ),
      { concurrency: 1 },
    );
  });

/** Resolve the p12 + provisioning profiles, from the local tree or the server. */
export const fetchAllCredentials = (params: {
  readonly api: ApiClient;
  readonly input: RunIosBuildInput;
  readonly mainBundleIdentifier: string;
  readonly allBundleIdentifiers: readonly string[];
}) =>
  params.input.credentialsSource === "local"
    ? loadLocalIosCredentials({
        projectRoot: params.input.projectRoot,
        mainBundleIdentifier: params.mainBundleIdentifier,
      })
    : downloadIosCredentials(params.api, {
        projectId: params.input.projectId,
        mainBundleIdentifier: params.mainBundleIdentifier,
        bundleIdentifiers: params.allBundleIdentifiers,
        distribution: params.input.iosProfile.distribution,
        tempDir: params.input.tempDir,
      });
