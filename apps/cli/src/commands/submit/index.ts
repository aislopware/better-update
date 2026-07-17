import { compact, toOptional } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runAndroidGooglePlayUpload } from "../../application/android-play-submit";
import { needsTestFlightConfig } from "../../application/ios-testflight-config";
import { ensureAscAppForSubmit } from "../../application/submit-asc-app";
import {
  ensureAscApiKeyForSubmit,
  resolveAscUploadCredentials,
} from "../../application/submit-asc-key";
import { createSubmissionViaApi } from "../../application/submit-flow";
import {
  fallbackPasswordAuth,
  hasAppleAppSpecificPassword,
  resolveIosUploadAuth,
  runIosSubmit,
} from "../../application/submit-ios-upload";
import { runEffect } from "../../lib/citty-effect";
import { readSubmitProfile } from "../../lib/eas-json";
import { printHuman } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";

import type { IosSubmitOutcome } from "../../application/submit-ios-upload";
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
}

/**
 * Run the iOS upload branch: resolve upload auth (stored key, app-specific
 * password, or an interactively-created ASC key), decrypt the `.p8` once,
 * resolve (or create) the ASC app, then upload — via the App Store Connect
 * Build Upload API when an ASC key is available (with progress), else `altool`.
 * Returns `null` when the submission was only queued (no client upload ran),
 * otherwise the submit outcome (build version + whether metadata was applied).
 */
const submitIosBranch = (params: {
  readonly api: ApiClient;
  readonly projectId: string;
  readonly projectRoot: string;
  readonly profile: string;
  readonly archive: RunArgs["archive"];
  readonly whatToTest: string | undefined;
  readonly iosProfile: EasIosSubmitProfile | undefined;
  readonly iosConfig: { readonly bundleIdentifier: string };
}) =>
  Effect.gen(function* () {
    const { api, iosProfile, iosConfig } = params;
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
          projectRoot: params.projectRoot,
          profileName: params.profile,
        });
        return resolvedKeyId === null
          ? null
          : ({ kind: "asc-api-key", ascApiKeyId: resolvedKeyId } as const);
      }));
    if (auth === null) {
      yield* printHuman(
        "iOS submission queued. Add ascApiKeyId to the eas.json submit profile, or set appleId + the EXPO_APPLE_APP_SPECIFIC_PASSWORD env var, to enable the client-side store upload.",
      );
      return null;
    }

    // Decrypt the ASC `.p8` once so the vault is unlocked a single time and the
    // same creds drive both the app lookup and the upload.
    const groups = iosProfile?.groups ?? [];
    const wantsConfig = needsTestFlightConfig({ whatToTest: params.whatToTest, groups });
    const ascCredentials = yield* resolveAscUploadCredentials({
      api,
      auth,
      ascApiKeyId: iosProfile?.ascApiKeyId,
      wantsConfig,
    });
    // An asc-api-key upload cannot proceed without the decrypted .p8 — but a
    // configured app-specific password (the pre-flip winner) still can: degrade
    // to it instead of skipping the upload a previous CLI performed.
    let effectiveAuth = auth;
    if (auth.kind === "asc-api-key" && ascCredentials === null) {
      const passwordAuth = fallbackPasswordAuth({
        appleId: iosProfile?.appleId,
        hasAppSpecificPassword: hasAppleAppSpecificPassword(),
      });
      if (passwordAuth === null) {
        yield* printHuman(
          "iOS submission queued — the ASC API key could not be prepared for upload.",
        );
        return null;
      }
      yield* printHuman(
        "The ASC API key could not be prepared — falling back to the Apple ID app-specific password upload.",
      );
      effectiveAuth = passwordAuth;
    }

    // Resolve (and, with consent, create) the ASC app: TestFlight config needs
    // it as a target, and the Build Upload API reserve call needs it for every
    // asc-api-key upload. Skipped only when ascAppId is already configured.
    let resolvedAscAppId = iosProfile?.ascAppId;
    if (resolvedAscAppId === undefined && ascCredentials !== null) {
      // Best-effort: the better-update project name pre-fills the create-app prompt
      // for non-Expo projects (no app.json `expo.name` to default from).
      const defaultAppName = yield* api.projects.get({ path: { id: params.projectId } }).pipe(
        Effect.map((project) => project.name),
        Effect.orElseSucceed(() => undefined),
      );
      resolvedAscAppId = toOptional(
        yield* ensureAscAppForSubmit({
          credentials: ascCredentials,
          projectRoot: params.projectRoot,
          profileName: params.profile,
          bundleIdentifier: iosConfig.bundleIdentifier,
          appName: iosProfile?.appName,
          defaultAppName,
          sku: iosProfile?.sku,
          companyName: iosProfile?.companyName,
          primaryLocale: iosProfile?.language,
        }),
      );
    }

    return yield* runIosSubmit({
      archive: { source: params.archive.archiveSource, value: params.archive.archiveUrl },
      auth: effectiveAuth,
      ascCredentials,
      config: {
        bundleIdentifier: iosConfig.bundleIdentifier,
        ascAppId: resolvedAscAppId,
        language: iosProfile?.language,
        whatToTest: params.whatToTest,
        groups,
      },
    });
  });

// Submission runs entirely client-side, so a server record is written only AFTER
// a local upload succeeds — the store is the source of truth, the record is
// history. iOS records even when TestFlight config failed (metadataComplete=false)
// so the dashboard shows the uploaded-but-incomplete build, then re-raises the
// config error; the record is keyed on buildVersion so a re-run updates it.
const runFlow = (api: ApiClient, projectId: string, args: RunArgs) =>
  Effect.gen(function* () {
    const iosConfig = buildIosCreatePayload(args.easProfile.ios, args.whatToTest);
    const androidConfig = buildAndroidCreatePayload(args.easProfile.android);

    let iosOutcome: IosSubmitOutcome | null = null;
    if (args.platform === "ios") {
      if (iosConfig === undefined) {
        yield* printHuman(
          "iOS submit requires ios.bundleIdentifier in the eas.json submit profile.",
        );
        return;
      }
      iosOutcome = yield* submitIosBranch({
        api,
        projectId,
        projectRoot: args.projectRoot,
        profile: args.profile,
        archive: args.archive,
        whatToTest: args.whatToTest,
        iosProfile: args.easProfile.ios,
        iosConfig,
      });
      // Queued / skipped (no auth configured) — nothing was uploaded, so record nothing.
      if (iosOutcome === null) {
        return;
      }
    }

    if (args.platform === "android") {
      if (args.easProfile.android === undefined) {
        yield* printHuman("Android submit requires an android submit profile in eas.json.");
        return;
      }
      yield* printHuman("Uploading bundle to Google Play locally...");
      const serviceAccountKeyId =
        args.serviceAccountKeyId ?? args.easProfile.android.serviceAccountKeyId;
      yield* runAndroidGooglePlayUpload({
        api,
        archive: { source: args.archive.archiveSource, value: args.archive.archiveUrl },
        androidProfile: args.easProfile.android,
        serviceAccountKeyId,
      });
    }

    const submission = yield* createSubmissionViaApi(api, {
      projectId,
      platform: args.platform,
      profileName: args.profile,
      archiveSource: args.archive.archiveSource,
      buildId: args.archive.buildId,
      archiveUrl: args.archive.archiveUrl,
      ...compact({ iosConfig, androidConfig }),
      metadataComplete: iosOutcome === null ? true : iosOutcome.metadataApplied,
      ...compact({ buildVersion: toOptional(iosOutcome?.buildVersion) }),
    });
    yield* printHuman(`Submission recorded: ${submission.id}`);
    if (iosOutcome?.metadataError) {
      return yield* iosOutcome.metadataError;
    }
    return submission;
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
          ...compact({
            whatToTest: args["what-to-test"],
            serviceAccountKeyId: args["service-account-key-id"],
          }),
        });
      }),
    ),
});
