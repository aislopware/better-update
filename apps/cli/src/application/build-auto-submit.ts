import { compact } from "@better-update/type-guards";
import { Effect } from "effect";

import { readSubmitProfile } from "../lib/eas-json";
import { printHuman } from "../lib/output";
import { CliRuntime } from "../services/cli-runtime";
import { runAndroidGooglePlayUpload } from "./android-play-submit";
import {
  createSubmissionViaApi,
  hasAppleAppSpecificPassword,
  pollSubmissionUntilTerminal,
  resolveIosUploadAuth,
  runIosSubmit,
} from "./submit-flow";

import type { Platform } from "../lib/build-profile";
import type { EasAndroidSubmitProfile, EasIosSubmitProfile } from "../lib/eas-config";
import type { ApiClient } from "../services/api-client";

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

/** Submit a freshly-built artifact to the store using the profile's submit config. */
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

    const submission = yield* createSubmissionViaApi(input.api, {
      projectId: input.projectId,
      platform: input.platform,
      profileName: input.profileName,
      archiveSource: "build",
      buildId: input.buildId,
      archiveUrl,
      ...compact({ iosConfig, androidConfig }),
    });

    yield* printHuman(`Submission created: ${submission.id} (${submission.status})`);

    if (input.platform === "ios" && iosConfig !== undefined) {
      const auth = resolveIosUploadAuth({
        appleId: easProfile.ios?.appleId,
        ascApiKeyId: easProfile.ios?.ascApiKeyId,
        hasAppSpecificPassword: hasAppleAppSpecificPassword(),
      });
      if (auth === null) {
        yield* printHuman(
          "Skipping iOS upload: configure ascApiKeyId or set EXPO_APPLE_APP_SPECIFIC_PASSWORD (+ appleId).",
        );
      } else {
        yield* printHuman(
          auth.kind === "app-specific-password"
            ? "Running xcrun altool upload (Apple ID app-specific password)..."
            : "Running xcrun altool upload (ASC API key)...",
        );
        yield* runIosSubmit({
          api: input.api,
          submissionId: submission.id,
          archive: { source: "build", value: archiveUrl },
          auth,
          ascApiKeyId: easProfile.ios?.ascApiKeyId,
          config: {
            bundleIdentifier: iosConfig.bundleIdentifier,
            ascAppId: easProfile.ios?.ascAppId,
            language: easProfile.ios?.language,
            whatToTest: input.whatToTest,
            groups: easProfile.ios?.groups ?? [],
          },
        });
      }
    }

    if (
      input.platform === "android" &&
      androidConfig !== undefined &&
      easProfile.android !== undefined
    ) {
      yield* printHuman("Uploading bundle to Google Play...");
      yield* runAndroidGooglePlayUpload({
        api: input.api,
        submissionId: submission.id,
        archive: { source: "build", value: archiveUrl },
        androidProfile: easProfile.android,
        serviceAccountKeyId: easProfile.android.serviceAccountKeyId,
      });
    }

    const terminal = yield* pollSubmissionUntilTerminal(input.api, submission.id);
    yield* printHuman(`Submission final status: ${terminal.status}`);
  });
