import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runAndroidGooglePlayUpload } from "../../application/android-play-submit";
import { ensureAscApiKeyForSubmit } from "../../application/submit-asc-key";
import {
  createSubmissionViaApi,
  hasAppleAppSpecificPassword,
  pollSubmissionUntilTerminal,
  resolveIosUploadAuth,
  runIosSubmit,
} from "../../application/submit-flow";
import { runEffect } from "../../lib/citty-effect";
import { readSubmitProfile } from "../../lib/eas-json";
import { printHuman } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";

import type {
  EasAndroidSubmitProfile,
  EasIosSubmitProfile,
  EasSubmitProfile,
} from "../../lib/eas-config";
import type { ApiClient } from "../../services/api-client";

const PLATFORMS = ["ios", "android"] as const;

const resolveArchive = (
  api: ApiClient,
  projectId: string,
  platform: "ios" | "android",
  args: {
    readonly id: string | undefined;
    readonly path: string | undefined;
    readonly url: string | undefined;
    readonly latest: boolean;
  },
) =>
  Effect.gen(function* () {
    if (args.path !== undefined) {
      return { archiveSource: "path" as const, archiveUrl: args.path, buildId: undefined };
    }
    if (args.url !== undefined) {
      return { archiveSource: "url" as const, archiveUrl: args.url, buildId: undefined };
    }
    if (args.id !== undefined) {
      const link = yield* api.builds.getInstallLink({ path: { id: args.id } });
      return {
        archiveSource: "build" as const,
        archiveUrl: link.artifactUrl,
        buildId: args.id,
      };
    }
    if (args.latest) {
      const { items } = yield* api.builds.list({
        urlParams: { projectId, limit: 1, platform, sort: "-createdAt" },
      });
      const [latest] = items;
      if (latest === undefined) {
        yield* printHuman(`No builds found for platform ${platform}`);
        return null;
      }
      const link = yield* api.builds.getInstallLink({ path: { id: latest.id } });
      return {
        archiveSource: "build" as const,
        archiveUrl: link.artifactUrl,
        buildId: latest.id,
      };
    }
    return null;
  });

const buildIosCreatePayload = (
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

const buildAndroidCreatePayload = (androidProfile: EasAndroidSubmitProfile | undefined) => {
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

interface RunArgs {
  readonly platform: "ios" | "android";
  readonly profile: string;
  /** Project root holding `eas.json`, for persisting an auto-resolved ASC key. */
  readonly projectRoot: string;
  readonly easProfile: EasSubmitProfile;
  readonly archive: {
    readonly archiveSource: "build" | "path" | "url";
    readonly archiveUrl: string;
    readonly buildId: string | undefined;
  };
  readonly whatToTest?: string;
  readonly serviceAccountKeyId?: string;
  readonly wait: boolean;
}

const runFlow = (api: ApiClient, projectId: string, args: RunArgs) =>
  Effect.gen(function* () {
    const iosConfig = buildIosCreatePayload(args.easProfile.ios, args.whatToTest);
    const androidConfig = buildAndroidCreatePayload(args.easProfile.android);

    const submission = yield* createSubmissionViaApi(api, {
      projectId,
      platform: args.platform,
      profileName: args.profile,
      archiveSource: args.archive.archiveSource,
      buildId: args.archive.buildId,
      archiveUrl: args.archive.archiveUrl,
      ...compact({ iosConfig, androidConfig }),
    });

    yield* printHuman(`Submission created: ${submission.id} (${submission.status})`);

    if (args.platform === "ios" && iosConfig !== undefined) {
      const iosProfile = args.easProfile.ios;
      // When nothing is configured, reuse a stored ASC key or offer to create one
      // from the Apple ID session (interactive only) before falling back to queuing.
      const auth =
        resolveIosUploadAuth({
          appleId: iosProfile?.appleId,
          ascApiKeyId: iosProfile?.ascApiKeyId,
          hasAppSpecificPassword: hasAppleAppSpecificPassword(),
        }) ??
        (yield* Effect.gen(function* () {
          const resolvedKeyId = yield* ensureAscApiKeyForSubmit({
            api,
            projectRoot: args.projectRoot,
            profileName: args.profile,
          });
          return resolvedKeyId === null
            ? null
            : ({ kind: "asc-api-key", ascApiKeyId: resolvedKeyId } as const);
        }));
      if (auth === null) {
        yield* printHuman(
          "iOS submission queued. Add ascApiKeyId to the eas.json submit profile, or set appleId + the EXPO_APPLE_APP_SPECIFIC_PASSWORD env var, to enable client-side altool upload.",
        );
        return submission;
      }
      yield* printHuman(
        auth.kind === "app-specific-password"
          ? "Running xcrun altool upload (Apple ID app-specific password)..."
          : "Running xcrun altool upload (ASC API key)...",
      );
      yield* runIosSubmit({
        api,
        submissionId: submission.id,
        archive: { source: args.archive.archiveSource, value: args.archive.archiveUrl },
        auth,
        ascApiKeyId: auth.kind === "asc-api-key" ? auth.ascApiKeyId : iosProfile?.ascApiKeyId,
        config: {
          bundleIdentifier: iosConfig.bundleIdentifier,
          ascAppId: iosProfile?.ascAppId,
          language: iosProfile?.language,
          whatToTest: args.whatToTest,
          groups: iosProfile?.groups ?? [],
        },
      });
    }

    if (args.platform === "android" && args.easProfile.android !== undefined) {
      yield* printHuman("Uploading bundle to Google Play locally...");
      const serviceAccountKeyId =
        args.serviceAccountKeyId ?? args.easProfile.android.serviceAccountKeyId;
      yield* runAndroidGooglePlayUpload({
        api,
        submissionId: submission.id,
        archive: { source: args.archive.archiveSource, value: args.archive.archiveUrl },
        androidProfile: args.easProfile.android,
        serviceAccountKeyId,
      });
    }

    if (!args.wait) {
      return submission;
    }

    const terminal = yield* pollSubmissionUntilTerminal(api, submission.id);
    yield* printHuman(`Final status: ${terminal.status}`);
    if (terminal.errorCode !== null) {
      yield* printHuman(`Error ${terminal.errorCode}: ${terminal.errorMessage ?? "(no detail)"}`);
    }
    return terminal;
  });

export const submitCommand = defineCommand({
  meta: {
    name: "submit",
    description: "Submit a build to App Store Connect or Google Play",
  },
  args: {
    platform: {
      type: "enum",
      options: [...PLATFORMS],
      description: "Target platform",
    },
    profile: {
      type: "string",
      default: "production",
      description: "eas.json submit profile name (default: production)",
    },
    latest: { type: "boolean", description: "Submit the latest build for the platform" },
    id: { type: "string", description: "Submit a specific build by ID" },
    path: { type: "string", description: "Submit a local IPA/AAB at this path (URL or file://)" },
    url: { type: "string", description: "Submit a binary fetched from this URL" },
    "what-to-test": {
      type: "string",
      description: "iOS-only TestFlight changelog ('What to test')",
    },
    "service-account-key-id": {
      type: "string",
      description:
        "Android-only: better-update saved Google service account key ID (overrides eas.json submit profile)",
    },
    wait: {
      type: "boolean",
      default: true,
      description: "Block until submission reaches a terminal status (default: true)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const { platform } = args;
        if (platform === undefined) {
          yield* printHuman("--platform is required (ios | android)");
          return;
        }

        const projectId = yield* readProjectId;
        const api = yield* apiClient;
        const runtime = yield* CliRuntime;
        const projectRoot = yield* runtime.cwd;
        const easProfile = yield* readSubmitProfile(projectRoot, args.profile);

        const archive = yield* resolveArchive(api, projectId, platform, {
          id: args.id,
          path: args.path,
          url: args.url,
          latest: args.latest ?? false,
        });
        if (archive === null) {
          yield* printHuman("No archive resolved. Pass one of --latest, --id, --path, or --url.");
          return;
        }

        yield* runFlow(api, projectId, {
          platform,
          profile: args.profile,
          projectRoot,
          easProfile,
          archive,
          wait: args.wait,
          ...compact({
            whatToTest: args["what-to-test"],
            serviceAccountKeyId: args["service-account-key-id"],
          }),
        });
      }),
    ),
});
