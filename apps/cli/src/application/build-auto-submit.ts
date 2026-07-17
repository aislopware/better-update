import { compact, toOptional } from "@better-update/type-guards";
import { Effect } from "effect";

import { readSubmitProfile } from "../lib/eas-json";
import { printHuman } from "../lib/output";
import { CliRuntime } from "../services/cli-runtime";
import { runAndroidGooglePlayUpload } from "./android-play-submit";
import { needsTestFlightConfig } from "./ios-testflight-config";
import { resolveAscUploadCredentials } from "./submit-asc-key";
import { createSubmissionViaApi } from "./submit-flow";
import {
  fallbackPasswordAuth,
  hasAppleAppSpecificPassword,
  resolveIosUploadAuth,
  runIosSubmit,
} from "./submit-ios-upload";

import type { Platform } from "../lib/build-profile";
import type { EasAndroidSubmitProfile, EasIosSubmitProfile } from "../lib/eas-config";
import type { ApiClient } from "../services/api-client";
import type { IosSubmitOutcome } from "./submit-ios-upload";

export interface AutoSubmitInput {
  readonly api: ApiClient;
  readonly buildId: string;
  readonly projectId: string;
  readonly platform: Platform;
  readonly profileName: string;
  readonly whatToTest?: string;
}

const buildAutoSubmitIosConfig = (
  iosProfile: EasIosSubmitProfile | undefined,
  whatToTest: string | undefined,
) => {
  if (iosProfile?.bundleIdentifier === undefined) {
    return undefined;
  }
  return compact({
    bundleIdentifier: iosProfile.bundleIdentifier,
    appleId: iosProfile.appleId,
    ascAppId: iosProfile.ascAppId,
    appleTeamId: iosProfile.appleTeamId,
    sku: iosProfile.sku,
    language: iosProfile.language,
    companyName: iosProfile.companyName,
    appName: iosProfile.appName,
    groups: iosProfile.groups,
    whatToTest,
  });
};

const buildAutoSubmitAndroidConfig = (androidProfile: EasAndroidSubmitProfile | undefined) => {
  if (androidProfile?.applicationId === undefined) {
    return undefined;
  }
  return compact({
    applicationId: androidProfile.applicationId,
    track: androidProfile.track,
    releaseStatus: androidProfile.releaseStatus,
    changesNotSentForReview: androidProfile.changesNotSentForReview,
    rollout: androidProfile.rollout,
  });
};

/**
 * Run the iOS store upload for an auto-submit (non-interactive: never creates an
 * ASC key). Uploads via the ASC Build Upload API when a key is configured, else
 * `altool`. Returns the submit outcome when the `.ipa` was uploaded (or already
 * on ASC), or null when skipped because no upload auth / ASC key is available.
 */
const autoSubmitIosUpload = (params: {
  readonly api: ApiClient;
  readonly iosProfile: EasIosSubmitProfile | undefined;
  readonly iosConfig: { readonly bundleIdentifier: string };
  readonly archiveUrl: string;
  readonly whatToTest: string | undefined;
}) =>
  Effect.gen(function* () {
    const { iosProfile } = params;
    const auth = resolveIosUploadAuth({
      appleId: iosProfile?.appleId,
      ascApiKeyId: iosProfile?.ascApiKeyId,
      hasAppSpecificPassword: hasAppleAppSpecificPassword(),
    });
    if (auth === null) {
      yield* printHuman(
        "Skipping iOS upload: configure ascApiKeyId or set EXPO_APPLE_APP_SPECIFIC_PASSWORD (+ appleId).",
      );
      return null;
    }
    const groups = iosProfile?.groups ?? [];
    const wantsConfig = needsTestFlightConfig({ whatToTest: params.whatToTest, groups });
    const ascCredentials = yield* resolveAscUploadCredentials({
      api: params.api,
      auth,
      ascApiKeyId: iosProfile?.ascApiKeyId,
      wantsConfig,
    });
    let effectiveAuth = auth;
    if (auth.kind === "asc-api-key" && ascCredentials === null) {
      const passwordAuth = fallbackPasswordAuth({
        appleId: iosProfile?.appleId,
        hasAppSpecificPassword: hasAppleAppSpecificPassword(),
      });
      if (passwordAuth === null) {
        yield* printHuman("Skipping iOS upload: the ASC API key could not be prepared for upload.");
        return null;
      }
      yield* printHuman(
        "The ASC API key could not be prepared — falling back to the Apple ID app-specific password upload.",
      );
      effectiveAuth = passwordAuth;
    }
    return yield* runIosSubmit({
      archive: { source: "build", value: params.archiveUrl },
      auth: effectiveAuth,
      ascCredentials,
      config: {
        bundleIdentifier: params.iosConfig.bundleIdentifier,
        ascAppId: iosProfile?.ascAppId,
        language: iosProfile?.language,
        whatToTest: params.whatToTest,
        groups,
      },
    });
  });

/**
 * Submit a freshly-built artifact to the store using the profile's submit config.
 * Records the submission only after the local upload succeeds.
 */
export const runAutoSubmit = (input: AutoSubmitInput) =>
  Effect.gen(function* () {
    yield* printHuman(`\nAuto-submitting build ${input.buildId} (profile ${input.profileName})...`);
    const runtime = yield* CliRuntime;
    const easProfile = yield* readSubmitProfile(yield* runtime.cwd, input.profileName);

    const installLink = yield* input.api.builds.getInstallLink({ path: { id: input.buildId } });
    const archiveUrl = installLink.artifactUrl;

    const iosConfig =
      input.platform === "ios"
        ? buildAutoSubmitIosConfig(easProfile.ios, input.whatToTest)
        : undefined;
    const androidConfig =
      input.platform === "android" ? buildAutoSubmitAndroidConfig(easProfile.android) : undefined;

    let iosOutcome: IosSubmitOutcome | null = null;
    if (input.platform === "ios") {
      if (iosConfig === undefined) {
        yield* printHuman(
          "Skipping iOS upload: set ios.bundleIdentifier in the eas.json submit profile.",
        );
        return;
      }
      iosOutcome = yield* autoSubmitIosUpload({
        api: input.api,
        iosProfile: easProfile.ios,
        iosConfig,
        archiveUrl,
        whatToTest: input.whatToTest,
      });
      if (iosOutcome === null) {
        return;
      }
    }

    if (input.platform === "android") {
      if (androidConfig === undefined || easProfile.android === undefined) {
        yield* printHuman(
          "Skipping Android upload: set android.applicationId in the eas.json submit profile.",
        );
        return;
      }
      yield* printHuman("Uploading bundle to Google Play...");
      yield* runAndroidGooglePlayUpload({
        api: input.api,
        archive: { source: "build", value: archiveUrl },
        androidProfile: easProfile.android,
        serviceAccountKeyId: easProfile.android.serviceAccountKeyId,
      });
    }

    const submission = yield* createSubmissionViaApi(input.api, {
      projectId: input.projectId,
      platform: input.platform,
      profileName: input.profileName,
      archiveSource: "build",
      buildId: input.buildId,
      archiveUrl,
      ...compact({ iosConfig, androidConfig }),
      metadataComplete: iosOutcome === null ? true : iosOutcome.metadataApplied,
      ...compact({ buildVersion: toOptional(iosOutcome?.buildVersion) }),
    });
    yield* printHuman(`Submission recorded: ${submission.id}`);
    // Surface a TestFlight-config failure AFTER the record exists, so the dashboard
    // shows the metadata-incomplete build rather than nothing.
    if (iosOutcome?.metadataError) {
      return yield* iosOutcome.metadataError;
    }
  });
