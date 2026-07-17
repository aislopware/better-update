/**
 * Client-side iOS store upload: pick the uploader (native Build Upload API
 * with byte progress when an ASC key is available, `xcrun altool` otherwise or
 * via the `BETTER_UPDATE_IOS_UPLOADER=altool` escape hatch), run it with
 * duplicate-build idempotency, then apply the optional TestFlight config.
 * The shared submit shell (archive staging, submission records) stays in
 * `submit-flow.ts`.
 */
import { toDbNull } from "@better-update/type-guards";
import { Effect } from "effect";

import { buildTokenRequestContext } from "../lib/apple-asc-connect";
import { uploadIpaViaBuildUploadApi } from "../lib/asc-build-upload";
import { readIpaVersionInfo } from "../lib/ipa-info";
import { printHuman } from "../lib/output";
import { makeUploadProgressReporter } from "../lib/upload-progress";
import { validateWhatsNew } from "../lib/whats-new";
import {
  applyTestFlightConfig,
  findBuildByVersion,
  needsTestFlightConfig,
  resolveTestFlightAppId,
} from "./ios-testflight-config";
import { CliSubmitError, resolveLocalArchivePath } from "./submit-flow";
import { uploadIpaViaAltool } from "./submit-ios-altool";

import type { AscCredentials } from "../lib/asc-credentials";
import type { IpaVersionInfo } from "../lib/ipa-info";
import type { ArchiveRef } from "./submit-flow";
import type { IosUploadAuth } from "./submit-ios-altool";

/** Auth shapes + the altool path live in submit-ios-altool; callers import from here. */
export { APPLE_APP_SPECIFIC_PASSWORD_ENV, hasAppleAppSpecificPassword } from "./submit-ios-altool";
export type { IosUploadAuth } from "./submit-ios-altool";

// ── iOS App Store Connect flow ───────────────────────────────────────────────

/**
 * Resolve the upload auth. The ASC API key wins when configured — it drives the
 * native Build Upload API path (headless, with byte progress) — and the Apple ID
 * app-specific password is the fallback. This intentionally diverges from
 * `eas submit` (which prefers the password): the ASC API path is first here.
 * Returns null when neither is configured.
 */
export const resolveIosUploadAuth = (params: {
  readonly appleId: string | undefined;
  readonly ascApiKeyId: string | undefined;
  readonly hasAppSpecificPassword: boolean;
}): IosUploadAuth | null => {
  // A blank/whitespace ascApiKeyId (scaffolded placeholder) counts as absent so
  // it can never shadow a working app-specific-password setup.
  const ascApiKeyId = params.ascApiKeyId?.trim();
  if (ascApiKeyId) {
    return { kind: "asc-api-key", ascApiKeyId };
  }
  if (params.hasAppSpecificPassword && params.appleId !== undefined) {
    return { kind: "app-specific-password", appleId: params.appleId };
  }
  return null;
};

/**
 * When the preferred ASC-key auth cannot be used (the `.p8` failed to decrypt —
 * e.g. CI without a robot identity), degrade to the app-specific-password path
 * that would have won before the key was configured, instead of skipping the
 * upload. Returns null when no password pair is available either.
 */
export const fallbackPasswordAuth = (params: {
  readonly appleId: string | undefined;
  readonly hasAppSpecificPassword: boolean;
}): IosUploadAuth | null =>
  params.hasAppSpecificPassword && params.appleId !== undefined
    ? { kind: "app-specific-password", appleId: params.appleId }
    : null;

/** Escape hatch: force the legacy `xcrun altool` uploader. */
export const IOS_UPLOADER_ENV = "BETTER_UPDATE_IOS_UPLOADER";

export type IosUploader = "asc-build-upload-api" | "altool";

/**
 * Pick the uploader for an iOS submit. The Build Upload API needs an ASC key,
 * the decrypted `.p8`, and both version strings out of the IPA; anything less
 * (or the env escape hatch) routes through `altool`.
 */
export const pickIosUploader = (params: {
  readonly auth: IosUploadAuth;
  readonly hasAscCredentials: boolean;
  readonly ipaInfo: IpaVersionInfo | null;
  readonly forceAltool: boolean;
}): IosUploader =>
  params.auth.kind === "asc-api-key" &&
  params.hasAscCredentials &&
  params.ipaInfo?.shortVersion !== undefined &&
  !params.forceAltool
    ? "asc-build-upload-api"
    : "altool";

interface IosSubmitInputs {
  readonly archive: ArchiveRef;
  readonly auth: IosUploadAuth;
  /** Decrypted ASC API key for the upload + TestFlight config; resolved by the caller. */
  readonly ascCredentials: AscCredentials | null;
  readonly config: {
    readonly bundleIdentifier: string;
    readonly ascAppId: string | undefined;
    readonly language: string | undefined;
    readonly whatToTest: string | undefined;
    readonly groups: readonly string[];
  };
}

/**
 * Upload the `.ipa` through the native Build Upload API with progress. A
 * reserve-phase failure (endpoint unavailable / unauthorized, before any bytes
 * moved) transparently falls back to `altool`; a duplicate build is the same
 * benign skip the altool path reports.
 */
const uploadIpaViaAscApi = (params: {
  readonly auth: IosUploadAuth;
  readonly ascCredentials: AscCredentials;
  readonly appId: string;
  readonly ipaPath: string;
  readonly shortVersion: string;
  readonly buildVersion: string;
}) =>
  Effect.gen(function* () {
    yield* printHuman("Uploading the IPA via the App Store Connect Build Upload API...");
    const reporter = yield* makeUploadProgressReporter("Uploading to App Store Connect");
    const outcome = yield* uploadIpaViaBuildUploadApi({
      credentials: params.ascCredentials,
      appId: params.appId,
      ipaPath: params.ipaPath,
      shortVersion: params.shortVersion,
      buildVersion: params.buildVersion,
      reporter,
    }).pipe(
      Effect.catchTag("AscBuildUploadUnavailableError", (error) =>
        printHuman(
          `Build Upload API unavailable (${error.message}) — falling back to xcrun altool.`,
        ).pipe(
          Effect.zipRight(
            uploadIpaViaAltool({
              auth: params.auth,
              ascCredentials: params.ascCredentials,
              ipaPath: params.ipaPath,
            }),
          ),
          Effect.as({ alreadyUploaded: false }),
        ),
      ),
      Effect.catchTag("AscBuildUploadError", (error) =>
        Effect.fail(
          new CliSubmitError({
            code: "SUBMISSION_SERVICE_IOS_UPLOAD_FAILED",
            message: error.message,
          }),
        ),
      ),
    );
    if (outcome.alreadyUploaded) {
      yield* printHuman(
        `Build ${params.buildVersion} is already on App Store Connect — skipping upload.`,
      );
    }
  });

const toSubmitError = (error: { readonly code: string; readonly message: string }) =>
  new CliSubmitError({ code: error.code, message: error.message });

/**
 * Resolve the ASC app id and check whether this exact build (by marketing
 * version + CFBundleVersion — Apple's dedupe pair) is already uploaded, so a
 * re-run after a metadata failure configures the existing build instead of
 * failing to re-upload a binary ASC won't accept twice.
 */
const resolveExistingBuild = (params: {
  readonly ascCredentials: AscCredentials;
  readonly ipaInfo: IpaVersionInfo;
  readonly config: IosSubmitInputs["config"];
}) =>
  Effect.gen(function* () {
    const appId = yield* resolveTestFlightAppId({
      credentials: params.ascCredentials,
      ascAppId: params.config.ascAppId,
      bundleIdentifier: params.config.bundleIdentifier,
    }).pipe(Effect.mapError(toSubmitError));
    const ctx = buildTokenRequestContext(params.ascCredentials);
    const existing = yield* findBuildByVersion(
      ctx,
      appId,
      params.ipaInfo.buildVersion,
      params.ipaInfo.shortVersion,
    ).pipe(Effect.mapError(toSubmitError));
    return { appId, alreadyUploaded: existing !== null };
  });

/** What a client-side iOS submit produced, for the caller to record + surface. */
export interface IosSubmitOutcome {
  /** CFBundleVersion of the uploaded/located build, when it could be read. */
  readonly buildVersion: string | null;
  /** False only when TestFlight config was attempted and failed. */
  readonly metadataApplied: boolean;
  /** The config failure to surface AFTER the submission is recorded, if any. */
  readonly metadataError: CliSubmitError | null;
}

/**
 * Configure TestFlight against the uploaded build. A failure here does NOT abort:
 * the binary is uploaded, so return it as metadata-incomplete for the caller to
 * record + surface, keeping the flow re-runnable.
 */
const configureUploadedBuild = (params: {
  readonly ascCredentials: AscCredentials;
  readonly appId: string;
  readonly ipaInfo: IpaVersionInfo;
  readonly config: IosSubmitInputs["config"];
}) =>
  Effect.gen(function* () {
    const configResult = yield* Effect.either(
      applyTestFlightConfig({
        credentials: params.ascCredentials,
        appId: params.appId,
        buildVersion: params.ipaInfo.buildVersion,
        shortVersion: params.ipaInfo.shortVersion,
        language: params.config.language,
        whatToTest: params.config.whatToTest,
        groups: params.config.groups,
      }),
    );
    if (configResult._tag === "Left") {
      const configError = configResult.left;
      yield* printHuman(`TestFlight configuration failed: ${configError.message}`);
      return {
        buildVersion: params.ipaInfo.buildVersion,
        metadataApplied: false,
        metadataError: new CliSubmitError({ code: configError.code, message: configError.message }),
      } satisfies IosSubmitOutcome;
    }
    return {
      buildVersion: params.ipaInfo.buildVersion,
      metadataApplied: true,
      metadataError: null,
    } satisfies IosSubmitOutcome;
  });

interface IosUploadTarget {
  readonly appId: string | null;
  readonly alreadyUploaded: boolean;
  /** The effective uploader — degraded to altool when the app id is missing. */
  readonly uploader: IosUploader;
}

/**
 * Resolve the ASC app and check whether this exact build is already uploaded —
 * needed for TestFlight config AND for the Build Upload API (its reserve call
 * targets the app record). A resolution failure aborts a TestFlight-config run
 * (config cannot proceed without the app) but only degrades an API-only run to
 * the altool uploader, which needs no app id.
 */
const resolveIosUploadTarget = (params: {
  readonly uploader: IosUploader;
  readonly wantsConfig: boolean;
  readonly wantsConfigWithKey: boolean;
  readonly ascCredentials: AscCredentials | null;
  readonly ipaInfo: IpaVersionInfo | null;
  readonly config: IosSubmitInputs["config"];
}) =>
  Effect.gen(function* () {
    const needsAppId = params.wantsConfigWithKey || params.uploader === "asc-build-upload-api";
    if (!needsAppId || params.ascCredentials === null || params.ipaInfo === null) {
      if (params.wantsConfig) {
        yield* printHuman(
          'Note: "What to Test" and TestFlight groups require an ASC API key (ascApiKeyId) — skipping that step for the app-specific-password upload.',
        );
      }
      return {
        appId: null,
        alreadyUploaded: false,
        uploader: params.uploader,
      } satisfies IosUploadTarget;
    }
    const resolved = yield* Effect.either(
      resolveExistingBuild({
        ascCredentials: params.ascCredentials,
        ipaInfo: params.ipaInfo,
        config: params.config,
      }),
    );
    if (resolved._tag === "Left") {
      if (params.wantsConfigWithKey) {
        // TestFlight config cannot proceed without the app record — fail loudly.
        return yield* resolved.left;
      }
      yield* printHuman(
        `Could not resolve the App Store Connect app (${resolved.left.message}) — using xcrun altool for the upload.`,
      );
      return { appId: null, alreadyUploaded: false, uploader: "altool" } satisfies IosUploadTarget;
    }
    if (resolved.right.alreadyUploaded) {
      yield* printHuman(
        `Build ${params.ipaInfo.buildVersion} is already on App Store Connect — skipping upload.`,
      );
    }
    return {
      appId: resolved.right.appId,
      alreadyUploaded: resolved.right.alreadyUploaded,
      uploader: params.uploader,
    } satisfies IosUploadTarget;
  });

export const runIosSubmit = (inputs: IosSubmitInputs) =>
  Effect.gen(function* () {
    const wantsConfig = needsTestFlightConfig({
      whatToTest: inputs.config.whatToTest,
      groups: inputs.config.groups,
    });
    // Reject bad "What to Test" text BEFORE the (slow) binary upload, so an
    // avoidable metadata error never costs a full altool run.
    if (inputs.config.whatToTest !== undefined) {
      const invalid = validateWhatsNew(inputs.config.whatToTest);
      if (invalid !== null) {
        return yield* new CliSubmitError({
          code: "SUBMISSION_INVALID_WHAT_TO_TEST",
          message: invalid.message,
        });
      }
    }
    // ASC credentials power the asc-api-key upload AND the TestFlight config; the
    // command layer decrypts them once and passes them in. Null for an
    // app-specific-password upload with no config wanted.
    const { ascCredentials } = inputs;
    const wantsConfigWithKey = wantsConfig && ascCredentials !== null;

    const ipaPath = yield* resolveLocalArchivePath(inputs.archive, ".ipa");

    // The CFBundleVersion makes the upload idempotent (skip when the build is
    // already on ASC) and lets us configure the exact build. Required with config.
    const ipaInfo = yield* readIpaVersionInfo(ipaPath).pipe(
      Effect.catchAll((error) =>
        wantsConfigWithKey
          ? Effect.fail(
              new CliSubmitError({ code: "SUBMISSION_IPA_READ_FAILED", message: error.message }),
            )
          : printHuman(`Note: ${error.message}`).pipe(Effect.as(null)),
      ),
    );

    const target = yield* resolveIosUploadTarget({
      uploader: pickIosUploader({
        auth: inputs.auth,
        hasAscCredentials: ascCredentials !== null,
        ipaInfo,
        forceAltool: process.env[IOS_UPLOADER_ENV] === "altool",
      }),
      wantsConfig,
      wantsConfigWithKey,
      ascCredentials,
      ipaInfo,
      config: inputs.config,
    });
    const { appId } = target;

    // Upload unless the build is already on App Store Connect.
    if (!target.alreadyUploaded) {
      if (
        target.uploader === "asc-build-upload-api" &&
        ascCredentials !== null &&
        appId !== null &&
        ipaInfo?.shortVersion !== undefined
      ) {
        yield* uploadIpaViaAscApi({
          auth: inputs.auth,
          ascCredentials,
          appId,
          ipaPath,
          shortVersion: ipaInfo.shortVersion,
          buildVersion: ipaInfo.buildVersion,
        });
      } else {
        yield* printHuman(
          inputs.auth.kind === "app-specific-password"
            ? "Uploading the IPA with xcrun altool (Apple ID app-specific password)..."
            : "Uploading the IPA with xcrun altool (ASC API key)...",
        );
        yield* uploadIpaViaAltool({ auth: inputs.auth, ascCredentials, ipaPath });
      }
    }

    if (wantsConfigWithKey && appId !== null && ipaInfo !== null) {
      return yield* configureUploadedBuild({
        ascCredentials,
        appId,
        ipaInfo,
        config: inputs.config,
      });
    }

    return {
      buildVersion: toDbNull(ipaInfo?.buildVersion),
      metadataApplied: true,
      metadataError: null,
    } satisfies IosSubmitOutcome;
  });
