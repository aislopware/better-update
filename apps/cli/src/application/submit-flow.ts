import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compact, toDbNull } from "@better-update/type-guards";
import { Effect, Schema } from "effect";

import type { CreateSubmissionBody, Submission } from "@better-update/api";

import { altoolFailureDetail, isDuplicateBuildUpload, runAltool } from "../lib/altool";
import { buildTokenRequestContext, messageOf } from "../lib/apple-asc-connect";
import { fetchAscCredentials } from "../lib/asc-credentials";
import { readIpaVersionInfo } from "../lib/ipa-info";
import { printHuman } from "../lib/output";
import { validateWhatsNew } from "../lib/whats-new";
import {
  applyTestFlightConfig,
  findBuildByVersion,
  needsTestFlightConfig,
  resolveTestFlightAppId,
} from "./ios-testflight-config";

import type { AscCredentials } from "../lib/asc-credentials";
import type { IpaVersionInfo } from "../lib/ipa-info";
import type { ApiClient } from "../services/api-client";

type SubmissionItem = Submission;

export class CliSubmitError extends Schema.TaggedError<CliSubmitError>()("CliSubmitError", {
  code: Schema.String,
  message: Schema.String,
}) {}

type CreatePayload = typeof CreateSubmissionBody.Type;

interface ResolvedSubmissionInput {
  readonly projectId: string;
  readonly platform: "ios" | "android";
  readonly profileName: string;
  readonly archiveSource: "build" | "path" | "url";
  readonly buildId: string | undefined;
  readonly archiveUrl: string | undefined;
  readonly iosConfig?: CreatePayload["iosConfig"];
  readonly androidConfig?: CreatePayload["androidConfig"];
  /** False when the iOS binary uploaded but TestFlight config did not complete. */
  readonly metadataComplete?: boolean | undefined;
  /** CFBundleVersion of the uploaded build — the iOS idempotency key server-side. */
  readonly buildVersion?: string | undefined;
}

export const createSubmissionViaApi = (
  api: ApiClient,
  resolved: ResolvedSubmissionInput,
): Effect.Effect<SubmissionItem, CliSubmitError> =>
  api.submissions
    .create({
      path: { projectId: resolved.projectId },
      payload: {
        platform: resolved.platform,
        profileName: resolved.profileName,
        archiveSource: resolved.archiveSource,
        ...compact({
          buildId: resolved.buildId,
          archiveUrl: resolved.archiveUrl,
          iosConfig: resolved.iosConfig,
          androidConfig: resolved.androidConfig,
          metadataComplete: resolved.metadataComplete,
          buildVersion: resolved.buildVersion,
        }),
      },
    })
    .pipe(
      Effect.mapError(
        () =>
          new CliSubmitError({
            code: "SUBMISSION_CREATE_FAILED",
            message: "Failed to create submission via API",
          }),
      ),
    );

// ── Archive resolution (shared) ──────────────────────────────────────────────

export interface ArchiveRef {
  readonly source: "build" | "path" | "url";
  readonly value: string;
}

/** A local `path` archive may be given as a plain path or a `file://` URL. */
export const localPathFromArchiveValue = (value: string): string =>
  value.startsWith("file://") ? fileURLToPath(value) : value;

const readLocalFile = (
  filePath: string,
  errorCode: string,
  errorMessageFmt: (cause: unknown) => string,
) =>
  Effect.tryPromise({
    try: async () => readFile(filePath),
    catch: (cause) =>
      new CliSubmitError({
        code: errorCode,
        message: errorMessageFmt(cause),
      }),
  });

const fetchArchiveOverHttp = (url: string) =>
  Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: async () => {
        const response = await fetch(url);
        const bytes = response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
        return { ok: response.ok, status: response.status, bytes };
      },
      catch: (cause) =>
        new CliSubmitError({
          code: "SUBMISSION_ARCHIVE_DOWNLOAD_FAILED",
          message: `Failed to download archive from ${url}: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });
    if (!result.ok || result.bytes === null) {
      return yield* new CliSubmitError({
        code: "SUBMISSION_ARCHIVE_DOWNLOAD_FAILED",
        message: `HTTP ${String(result.status)} fetching archive at ${url}`,
      });
    }
    return result.bytes;
  });

export const readArchiveBytes = (archive: ArchiveRef) =>
  archive.source === "path"
    ? Effect.map(
        readLocalFile(
          localPathFromArchiveValue(archive.value),
          "SUBMISSION_ARCHIVE_READ_FAILED",
          (cause) =>
            `Failed to read archive at ${archive.value}: ${cause instanceof Error ? cause.message : String(cause)}`,
        ),
        (buf) => new Uint8Array(buf),
      )
    : fetchArchiveOverHttp(archive.value);

const downloadArchiveToTempFile = (url: string, extension: string) =>
  Effect.gen(function* () {
    const bytes = yield* fetchArchiveOverHttp(url);
    const target = path.join(tmpdir(), `better-update-submit-${crypto.randomUUID()}${extension}`);
    yield* Effect.tryPromise({
      try: async () => writeFile(target, bytes),
      catch: (cause) =>
        new CliSubmitError({
          code: "SUBMISSION_ARCHIVE_WRITE_FAILED",
          message: `Failed to stage archive to ${target}: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });
    return target;
  });

/**
 * Resolve an archive to a **local file path** on disk, downloading remote
 * (`build`/`url`) sources first. Store upload tools (`altool`) require a path
 * they can open — handing them an https URL fails.
 */
const resolveLocalArchivePath = (archive: ArchiveRef, extension: string) =>
  archive.source === "path"
    ? Effect.succeed(localPathFromArchiveValue(archive.value))
    : downloadArchiveToTempFile(archive.value, extension);

// ── iOS App Store Connect flow ───────────────────────────────────────────────

/** EAS-compatible env var carrying the Apple ID app-specific password. */
export const APPLE_APP_SPECIFIC_PASSWORD_ENV = "EXPO_APPLE_APP_SPECIFIC_PASSWORD";

/**
 * How the `.ipa` is authenticated to App Store Connect, mirroring `eas submit`'s
 * two mutually-exclusive paths: an ASC API key (`.p8`) or an Apple ID + an
 * app-specific password supplied via {@link APPLE_APP_SPECIFIC_PASSWORD_ENV}.
 */
export type IosUploadAuth =
  | { readonly kind: "asc-api-key"; readonly ascApiKeyId: string }
  | { readonly kind: "app-specific-password"; readonly appleId: string };

export const hasAppleAppSpecificPassword = (): boolean => {
  const value = process.env[APPLE_APP_SPECIFIC_PASSWORD_ENV];
  return value !== undefined && value !== "";
};

/**
 * Resolve the upload auth, matching `eas submit` precedence: an app-specific
 * password (env var + `appleId`) wins when usable; otherwise fall back to the
 * ASC API key. Returns null when neither is configured.
 */
export const resolveIosUploadAuth = (params: {
  readonly appleId: string | undefined;
  readonly ascApiKeyId: string | undefined;
  readonly hasAppSpecificPassword: boolean;
}): IosUploadAuth | null => {
  if (params.hasAppSpecificPassword && params.appleId !== undefined) {
    return { kind: "app-specific-password", appleId: params.appleId };
  }
  if (params.ascApiKeyId !== undefined) {
    return { kind: "asc-api-key", ascApiKeyId: params.ascApiKeyId };
  }
  return null;
};

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
 * Decrypt the ASC `.p8` once for a submit: needed for an asc-api-key upload, and
 * for post-upload TestFlight config regardless of upload auth. Returns null when
 * none is required or available; a decrypt failure logs a note and degrades to
 * null so the caller can queue-and-instruct rather than crash.
 */
export const resolveAscUploadCredentials = (params: {
  readonly api: ApiClient;
  readonly auth: IosUploadAuth;
  readonly ascApiKeyId: string | undefined;
  readonly wantsConfig: boolean;
}) =>
  Effect.gen(function* () {
    const credsKeyId =
      params.auth.kind === "asc-api-key" ? params.auth.ascApiKeyId : params.ascApiKeyId;
    const needsCreds = params.auth.kind === "asc-api-key" || params.wantsConfig;
    if (!needsCreds || credsKeyId === undefined) {
      return null;
    }
    return yield* fetchAscCredentials(params.api, credsKeyId).pipe(
      Effect.map((creds) => ({ keyId: creds.keyId, issuerId: creds.issuerId, p8Pem: creds.p8Pem })),
      Effect.catchAll((error) =>
        printHuman(`Could not prepare ASC API key ${credsKeyId} (${messageOf(error)}).`).pipe(
          Effect.as(null),
        ),
      ),
    );
  });

/**
 * `altool --apiKey <id>` searches for a file named *exactly* `AuthKey_<id>.p8` in
 * the standard `private_keys` dirs plus `$API_PRIVATE_KEYS_DIR`. Write the decrypted
 * `.p8` under that exact name into a fresh private temp dir and return the dir so the
 * caller can point `API_PRIVATE_KEYS_DIR` at it (and remove it afterward — it holds
 * the unencrypted signing key).
 */
const writeP8KeyDir = (credentials: AscCredentials) =>
  Effect.promise(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "better-update-asc-"));
    await writeFile(path.join(dir, `AuthKey_${credentials.keyId}.p8`), credentials.p8Pem, "utf8");
    return dir;
  });

const removeKeyDir = (dir: string) =>
  Effect.promise(async () => {
    await rm(dir, { recursive: true, force: true });
  });

const baseAltoolArgs = (ipaPath: string): readonly string[] => [
  "--upload-app",
  "--type",
  "ios",
  "--file",
  ipaPath,
  "--output-format",
  "xml",
];

/** Build `altool` args for the chosen auth. The app-specific password is passed
 * as `@env:` so it never enters argv; `altool` reads it from the inherited env. */
const buildAltoolArgs = (params: {
  readonly auth: IosUploadAuth;
  readonly ascCredentials: AscCredentials | null;
  readonly ipaPath: string;
}) =>
  Effect.gen(function* () {
    if (params.auth.kind === "app-specific-password") {
      return [
        ...baseAltoolArgs(params.ipaPath),
        "--username",
        params.auth.appleId,
        "--password",
        `@env:${APPLE_APP_SPECIFIC_PASSWORD_ENV}`,
      ];
    }
    if (params.ascCredentials === null) {
      return yield* new CliSubmitError({
        code: "SUBMISSION_ASC_KEY_FETCH_FAILED",
        message: "ASC API key is required for an asc-api-key upload but was not resolved.",
      });
    }
    // The `.p8` is located by name via `$API_PRIVATE_KEYS_DIR`, set when running altool.
    return [
      ...baseAltoolArgs(params.ipaPath),
      "--apiKey",
      params.ascCredentials.keyId,
      "--apiIssuer",
      params.ascCredentials.issuerId,
    ];
  });

/**
 * Run `altool` to upload the `.ipa`. For an ASC API key, altool finds the `.p8` by
 * name via `$API_PRIVATE_KEYS_DIR`; stage it in a temp dir scoped to the upload and
 * remove it after. A duplicate-build rejection is benign (already there) — return.
 */
const uploadIpaViaAltool = (params: {
  readonly auth: IosUploadAuth;
  readonly ascCredentials: AscCredentials | null;
  readonly ipaPath: string;
}) =>
  Effect.gen(function* () {
    const altoolArgs = yield* buildAltoolArgs(params);
    const result =
      params.auth.kind === "asc-api-key" && params.ascCredentials !== null
        ? yield* Effect.acquireUseRelease(
            writeP8KeyDir(params.ascCredentials),
            (keyDir) => runAltool(altoolArgs, { API_PRIVATE_KEYS_DIR: keyDir }),
            (keyDir) => removeKeyDir(keyDir),
          )
        : yield* runAltool(altoolArgs);
    if (result.exitCode === 0) {
      yield* printHuman("altool upload complete.");
      return;
    }
    const detail = altoolFailureDetail(result);
    if (isDuplicateBuildUpload(detail)) {
      yield* printHuman(
        `Build already on App Store Connect (${detail}) — continuing to TestFlight configuration.`,
      );
      return;
    }
    return yield* new CliSubmitError({
      code: "SUBMISSION_SERVICE_IOS_ALTOOL_FAILED",
      message: `xcrun altool exited ${String(result.exitCode)}: ${detail}`,
    });
  });

/**
 * Resolve the ASC app id and check whether this exact build (by CFBundleVersion)
 * is already uploaded, so a re-run after a metadata failure configures the
 * existing build instead of failing to re-upload a binary ASC won't accept twice.
 */
const resolveExistingBuild = (params: {
  readonly ascCredentials: AscCredentials;
  readonly ipaInfo: IpaVersionInfo;
  readonly config: IosSubmitInputs["config"];
}) =>
  Effect.gen(function* () {
    const toSubmitError = (error: { readonly code: string; readonly message: string }) =>
      new CliSubmitError({ code: error.code, message: error.message });
    const appId = yield* resolveTestFlightAppId({
      credentials: params.ascCredentials,
      ascAppId: params.config.ascAppId,
      bundleIdentifier: params.config.bundleIdentifier,
    }).pipe(Effect.mapError(toSubmitError));
    const ctx = buildTokenRequestContext(params.ascCredentials);
    const existing = yield* findBuildByVersion(ctx, appId, params.ipaInfo.buildVersion).pipe(
      Effect.mapError(toSubmitError),
    );
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

    // Resolve the ASC app and check whether this exact build is already uploaded.
    let appId: string | null = null;
    let alreadyUploaded = false;
    if (wantsConfigWithKey && ipaInfo !== null) {
      const resolved = yield* resolveExistingBuild({
        ascCredentials,
        ipaInfo,
        config: inputs.config,
      });
      ({ appId } = resolved);
      ({ alreadyUploaded } = resolved);
      if (alreadyUploaded) {
        yield* printHuman(
          `Build ${ipaInfo.buildVersion} is already on App Store Connect — skipping upload.`,
        );
      }
    } else if (wantsConfig) {
      yield* printHuman(
        'Note: "What to Test" and TestFlight groups require an ASC API key (ascApiKeyId) — skipping that step for the app-specific-password upload.',
      );
    }

    // Upload unless the build is already on App Store Connect.
    if (!alreadyUploaded) {
      yield* uploadIpaViaAltool({ auth: inputs.auth, ascCredentials, ipaPath });
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
