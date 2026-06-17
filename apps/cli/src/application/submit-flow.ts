import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { compact } from "@better-update/type-guards";
import { Duration, Effect, Schema } from "effect";

import type { CreateSubmissionBody, Submission, SubmissionStatus } from "@better-update/api";

import { fetchAscCredentials } from "../lib/asc-credentials";
import { printHuman } from "../lib/output";
import {
  applyTestFlightConfig,
  captureTestFlightContext,
  needsTestFlightConfig,
} from "./ios-testflight-config";

import type { AscCredentials } from "../lib/apple-asc-client";
import type { ApiClient } from "../services/api-client";

type SubmissionItem = Submission;
type SubmissionStatusValue = typeof SubmissionStatus.Type;

const execFileAsync = promisify(execFile);

interface ExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const ExecErrorSchema = Schema.Struct({
  code: Schema.optional(Schema.Number),
  stdout: Schema.optional(Schema.String),
  stderr: Schema.optional(Schema.String),
});

const runAltool = (args: readonly string[]) =>
  Effect.tryPromise({
    try: async (): Promise<ExecResult> => {
      const { stdout, stderr } = await execFileAsync("xcrun", ["altool", ...args]);
      return { exitCode: 0, stdout, stderr };
    },
    catch: (error: unknown): ExecResult => {
      const parsed = Schema.decodeUnknownSync(ExecErrorSchema, { onExcessProperty: "ignore" })(
        typeof error === "object" && error !== null ? error : {},
      );
      // eslint-disable-next-line eslint-js/no-restricted-syntax -- stdout legitimately empty when altool fails fast, distinguished by exitCode
      const stdout = parsed.stdout ?? "";
      const stderr = parsed.stderr ?? String(error);
      return {
        exitCode: parsed.code ?? 1,
        stdout,
        stderr: stderr === "" ? String(error) : stderr,
      };
    },
  }).pipe(Effect.catchAll((result) => Effect.succeed(result)));

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

const isTerminal = (status: SubmissionStatusValue): boolean =>
  status === "FINISHED" || status === "ERRORED" || status === "CANCELED";

const fetchSubmission = (api: ApiClient, submissionId: string) =>
  api.submissions.get({ path: { id: submissionId } }).pipe(
    Effect.mapError(
      () =>
        new CliSubmitError({
          code: "SUBMISSION_GET_FAILED",
          message: "Failed to read submission status",
        }),
    ),
  );

export const pollSubmissionUntilTerminal = (
  api: ApiClient,
  submissionId: string,
  pollIntervalMs = 5000,
) =>
  Effect.iterate(undefined as SubmissionItem | undefined, {
    while: (state: SubmissionItem | undefined) => state === undefined || !isTerminal(state.status),
    body: (state: SubmissionItem | undefined) =>
      Effect.gen(function* () {
        if (state !== undefined) {
          yield* Effect.sleep(Duration.millis(pollIntervalMs));
        }
        const next = yield* fetchSubmission(api, submissionId);
        yield* printHuman(`status: ${next.status}`);
        return next;
      }),
  }).pipe(
    Effect.flatMap((final) =>
      final === undefined
        ? Effect.fail(
            new CliSubmitError({
              code: "SUBMISSION_POLL_NO_RESULT",
              message: "Polling completed without producing a submission",
            }),
          )
        : Effect.succeed(final),
    ),
  );

// ── Archive resolution + status patching (shared) ────────────────────────────

export interface ArchiveRef {
  readonly source: "build" | "path" | "url";
  readonly value: string;
}

export const patchSubmissionStatus = (
  api: ApiClient,
  submissionId: string,
  payload: {
    readonly status: SubmissionStatusValue;
    readonly errorCode?: string;
    readonly errorMessage?: string;
  },
) =>
  api.submissions.updateStatus({ path: { id: submissionId }, payload }).pipe(
    Effect.mapError(
      () =>
        new CliSubmitError({
          code: "SUBMISSION_PATCH_FAILED",
          message: `Failed to PATCH submission status to ${payload.status}`,
        }),
    ),
  );

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
  readonly api: ApiClient;
  readonly submissionId: string;
  readonly archive: ArchiveRef;
  readonly auth: IosUploadAuth;
  /** ASC API key for post-upload TestFlight config; may differ from upload auth. */
  readonly ascApiKeyId: string | undefined;
  readonly config: {
    readonly bundleIdentifier: string;
    readonly ascAppId: string | undefined;
    readonly language: string | undefined;
    readonly whatToTest: string | undefined;
    readonly groups: readonly string[];
  };
}

const resolveAscCredentials = (api: ApiClient, ascApiKeyId: string) =>
  fetchAscCredentials(api, ascApiKeyId).pipe(
    Effect.mapError(
      () =>
        new CliSubmitError({
          code: "SUBMISSION_ASC_KEY_FETCH_FAILED",
          message: `Failed to fetch or decrypt ASC API key ${ascApiKeyId}`,
        }),
    ),
  );

/** `altool` reads the API key from `--apiKeyDir`; write the decrypted `.p8` there. */
const writeP8ForAltool = (credentials: AscCredentials) =>
  Effect.gen(function* () {
    const target = path.join(tmpdir(), `better-update-submit-AuthKey_${credentials.keyId}.p8`);
    yield* Effect.promise(async () => writeFile(target, credentials.p8Pem, "utf8"));
    return target;
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
    const p8Path = yield* writeP8ForAltool(params.ascCredentials);
    return [
      ...baseAltoolArgs(params.ipaPath),
      "--apiKey",
      params.ascCredentials.keyId,
      "--apiIssuer",
      params.ascCredentials.issuerId,
      "--apiKeyDir",
      path.dirname(p8Path),
    ];
  });

export const runIosSubmit = (inputs: IosSubmitInputs) =>
  Effect.gen(function* () {
    const wantsConfig = needsTestFlightConfig({
      whatToTest: inputs.config.whatToTest,
      groups: inputs.config.groups,
    });
    // ASC credentials power the asc-api-key upload AND the TestFlight config.
    // The app-specific-password upload needs none, but the config still does.
    const credsKeyId =
      inputs.auth.kind === "asc-api-key" ? inputs.auth.ascApiKeyId : inputs.ascApiKeyId;
    const needsCreds = inputs.auth.kind === "asc-api-key" || wantsConfig;
    const ascCredentials =
      needsCreds && credsKeyId !== undefined
        ? yield* resolveAscCredentials(inputs.api, credsKeyId)
        : null;

    const ipaPath = yield* resolveLocalArchivePath(inputs.archive, ".ipa");

    // Snapshot existing builds BEFORE upload so the new one can be identified.
    // Skips (with a note) when config is wanted but no ASC key is available.
    let tfContext = null;
    if (wantsConfig && ascCredentials !== null) {
      tfContext = yield* captureTestFlightContext({
        credentials: ascCredentials,
        ascAppId: inputs.config.ascAppId,
        bundleIdentifier: inputs.config.bundleIdentifier,
      }).pipe(
        Effect.mapError(
          (error) => new CliSubmitError({ code: error.code, message: error.message }),
        ),
      );
    } else if (wantsConfig) {
      yield* printHuman(
        'Note: "What to Test" and TestFlight groups require an ASC API key (ascApiKeyId) — skipping that step for the app-specific-password upload.',
      );
    }

    const altoolArgs = yield* buildAltoolArgs({ auth: inputs.auth, ascCredentials, ipaPath });

    yield* patchSubmissionStatus(inputs.api, inputs.submissionId, { status: "IN_PROGRESS" });

    const result = yield* runAltool(altoolArgs);

    if (result.exitCode !== 0) {
      yield* patchSubmissionStatus(inputs.api, inputs.submissionId, {
        status: "ERRORED",
        errorCode: "SUBMISSION_SERVICE_IOS_ALTOOL_FAILED",
        errorMessage: `xcrun altool exited ${String(result.exitCode)}: ${result.stderr}`,
      });
      return { status: "ERRORED" as SubmissionStatusValue };
    }
    yield* printHuman("altool upload complete.");

    if (tfContext !== null && ascCredentials !== null) {
      yield* applyTestFlightConfig({
        credentials: ascCredentials,
        context: tfContext,
        language: inputs.config.language,
        whatToTest: inputs.config.whatToTest,
        groups: inputs.config.groups,
      }).pipe(
        Effect.catchTag("TestFlightConfigError", (configError) =>
          Effect.gen(function* () {
            yield* patchSubmissionStatus(inputs.api, inputs.submissionId, {
              status: "ERRORED",
              errorCode: configError.code,
              errorMessage: configError.message,
            });
            return yield* new CliSubmitError({
              code: configError.code,
              message: configError.message,
            });
          }),
        ),
      );
    }

    yield* patchSubmissionStatus(inputs.api, inputs.submissionId, { status: "FINISHED" });
    return { status: "FINISHED" as SubmissionStatusValue };
  });
