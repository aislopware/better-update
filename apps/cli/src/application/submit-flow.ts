import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { compact, toDbNull } from "@better-update/type-guards";
import { Duration, Effect, Schema } from "effect";

import type { CreateSubmissionBody, Submission, SubmissionStatus } from "@better-update/api";

import { fetchAscCredentials } from "../lib/asc-credentials";
import {
  acquireGooglePlayAccessToken,
  commitEdit,
  insertEdit,
  updateTrack,
  uploadBundle,
} from "../lib/google-play";
import { printHuman } from "../lib/output";
import { openFromDownload, openVaultSessionInteractive } from "./credential-cipher";

import type { EasAndroidSubmitProfile } from "../lib/eas-submit-config";
import type { ApiClient } from "../services/api-client";

type SubmissionItem = typeof Submission.Type;
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

// ── iOS altool flow ─────────────────────────────────────────────────────────

interface IosAltoolInputs {
  readonly api: ApiClient;
  readonly submissionId: string;
  readonly ipaPath: string;
  readonly ascApiKeyId: string;
}

const writeAscApiKeyP8 = (api: ApiClient, ascApiKeyId: string) =>
  Effect.gen(function* () {
    const creds = yield* fetchAscCredentials(api, ascApiKeyId).pipe(
      Effect.mapError(
        () =>
          new CliSubmitError({
            code: "SUBMISSION_ASC_KEY_FETCH_FAILED",
            message: `Failed to fetch or decrypt ASC API key ${ascApiKeyId}`,
          }),
      ),
    );
    const target = path.join(tmpdir(), `better-update-submit-AuthKey_${creds.keyId}.p8`);
    yield* Effect.promise(async () => writeFile(target, creds.p8Pem, "utf8"));
    return { p8Path: target, keyId: creds.keyId, issuerId: creds.issuerId };
  });

export const runIosAltoolUpload = (inputs: IosAltoolInputs) =>
  Effect.gen(function* () {
    const creds = yield* writeAscApiKeyP8(inputs.api, inputs.ascApiKeyId);
    const apiKeyDir = path.dirname(creds.p8Path);

    yield* inputs.api.submissions
      .updateStatus({
        path: { id: inputs.submissionId },
        payload: { status: "IN_PROGRESS" },
      })
      .pipe(
        Effect.mapError(
          () =>
            new CliSubmitError({
              code: "SUBMISSION_PATCH_FAILED",
              message: "Failed to PATCH submission status to IN_PROGRESS",
            }),
        ),
      );

    const result = yield* runAltool([
      "--upload-app",
      "--type",
      "ios",
      "--apiKey",
      creds.keyId,
      "--apiIssuer",
      creds.issuerId,
      "--apiKeyDir",
      apiKeyDir,
      "--file",
      inputs.ipaPath,
      "--output-format",
      "xml",
    ]);

    const terminalStatus: SubmissionStatusValue = result.exitCode === 0 ? "FINISHED" : "ERRORED";
    const errorMessage =
      result.exitCode === 0
        ? null
        : `xcrun altool exited ${String(result.exitCode)}: ${result.stderr}`;

    yield* inputs.api.submissions
      .updateStatus({
        path: { id: inputs.submissionId },
        payload: {
          status: terminalStatus,
          ...(errorMessage
            ? { errorCode: "SUBMISSION_SERVICE_IOS_ALTOOL_FAILED", errorMessage }
            : {}),
        },
      })
      .pipe(
        Effect.mapError(
          () =>
            new CliSubmitError({
              code: "SUBMISSION_PATCH_FAILED",
              message: "Failed to PATCH submission terminal status",
            }),
        ),
      );

    return { status: terminalStatus, stdout: result.stdout, stderr: result.stderr };
  });

// ── Android Google Play flow ──────────────────────────────────────────────

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
          message: `Failed to download AAB from ${url}: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });
    if (!result.ok || result.bytes === null) {
      return yield* Effect.fail(
        new CliSubmitError({
          code: "SUBMISSION_ARCHIVE_DOWNLOAD_FAILED",
          message: `HTTP ${String(result.status)} fetching archive at ${url}`,
        }),
      );
    }
    return result.bytes;
  });

const readArchiveBytes = (archive: { source: "build" | "path" | "url"; value: string }) =>
  archive.source === "path"
    ? Effect.map(
        readLocalFile(
          archive.value,
          "SUBMISSION_ARCHIVE_READ_FAILED",
          (cause) =>
            `Failed to read AAB at ${archive.value}: ${cause instanceof Error ? cause.message : String(cause)}`,
        ),
        (buf) => new Uint8Array(buf),
      )
    : fetchArchiveOverHttp(archive.value);

const fetchServiceAccountKeyById = (api: ApiClient, id: string) =>
  Effect.gen(function* () {
    const data = yield* api.googleServiceAccountKeys.download({ path: { id } }).pipe(
      Effect.mapError(
        () =>
          new CliSubmitError({
            code: "SUBMISSION_ANDROID_SA_KEY_FETCH_FAILED",
            message: `Failed to download Google service account key ${id}`,
          }),
      ),
    );
    const session = yield* openVaultSessionInteractive(api).pipe(
      Effect.mapError(
        (cause) =>
          new CliSubmitError({
            code: "SUBMISSION_VAULT_UNLOCK_FAILED",
            message: `Could not unlock the credential vault: ${cause.message}`,
          }),
      ),
    );
    const secret = yield* openFromDownload({
      session,
      credentialType: "google-service-account-key",
      downloaded: data,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new CliSubmitError({
            code: "SUBMISSION_ANDROID_SA_KEY_DECRYPT_FAILED",
            message: `Failed to decrypt Google service account key ${id}: ${cause.message}`,
          }),
      ),
    );
    const { json } = secret;
    if (typeof json !== "string") {
      return yield* new CliSubmitError({
        code: "SUBMISSION_ANDROID_SA_KEY_DECRYPT_FAILED",
        message: `Decrypted Google service account key ${id} is missing its JSON.`,
      });
    }
    return json;
  });

const resolveServiceAccountJson = (params: {
  readonly api: ApiClient;
  readonly serviceAccountKeyId: string | undefined;
  readonly serviceAccountKeyPath: string | undefined;
}) => {
  if (params.serviceAccountKeyId !== undefined) {
    return fetchServiceAccountKeyById(params.api, params.serviceAccountKeyId);
  }
  if (params.serviceAccountKeyPath !== undefined) {
    return Effect.map(
      readLocalFile(
        params.serviceAccountKeyPath,
        "SUBMISSION_ANDROID_SA_KEY_LOCAL_READ_FAILED",
        (cause) =>
          `Failed to read service account JSON at ${String(params.serviceAccountKeyPath)}: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
      (buf) => new TextDecoder().decode(buf),
    );
  }
  return Effect.fail(
    new CliSubmitError({
      code: "SUBMISSION_ANDROID_SA_KEY_MISSING",
      message:
        "Android submission requires a service account key. Pass --service-account-key-id <id>, set serviceAccountKeyId in eas.json submit profile, or set serviceAccountKeyPath to a local JSON file.",
    }),
  );
};

const patchSubmissionStatus = (
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

const wrapGooglePlayError = (label: string) => (cause: { readonly message: string }) =>
  new CliSubmitError({
    code: `SUBMISSION_ANDROID_${label}`,
    message: cause.message,
  });

interface AndroidGooglePlayUploadInputs {
  readonly api: ApiClient;
  readonly submissionId: string;
  readonly archive: { readonly source: "build" | "path" | "url"; readonly value: string };
  readonly androidProfile: EasAndroidSubmitProfile;
  readonly serviceAccountKeyId: string | undefined;
}

const runGooglePlayPipeline = (params: {
  readonly accessToken: string;
  readonly applicationId: string;
  readonly aab: Uint8Array;
  readonly track: string;
  readonly releaseStatus: "completed" | "draft" | "halted" | "inProgress";
  readonly changesNotSentForReview: boolean;
  readonly rollout: number | null;
}) =>
  Effect.gen(function* () {
    const edit = yield* insertEdit({
      accessToken: params.accessToken,
      packageName: params.applicationId,
    }).pipe(Effect.mapError(wrapGooglePlayError("EDIT_INSERT_FAILED")));
    const uploaded = yield* uploadBundle({
      accessToken: params.accessToken,
      packageName: params.applicationId,
      editId: edit.id,
      aabBytes: params.aab,
    }).pipe(Effect.mapError(wrapGooglePlayError("BUNDLE_UPLOAD_FAILED")));
    yield* updateTrack({
      accessToken: params.accessToken,
      packageName: params.applicationId,
      editId: edit.id,
      track: params.track,
      releaseStatus: params.releaseStatus,
      versionCode: uploaded.versionCode,
      rollout: params.rollout,
    }).pipe(Effect.mapError(wrapGooglePlayError("TRACK_UPDATE_FAILED")));
    yield* commitEdit({
      accessToken: params.accessToken,
      packageName: params.applicationId,
      editId: edit.id,
      changesNotSentForReview: params.changesNotSentForReview,
    }).pipe(Effect.mapError(wrapGooglePlayError("COMMIT_FAILED")));
    return uploaded;
  });

export const runAndroidGooglePlayUpload = (inputs: AndroidGooglePlayUploadInputs) =>
  Effect.gen(function* () {
    const { applicationId } = inputs.androidProfile;
    if (applicationId === undefined) {
      return yield* Effect.fail(
        new CliSubmitError({
          code: "SUBMISSION_ANDROID_APP_ID_MISSING",
          message:
            "Android submit profile requires applicationId — set submit.<profile>.android.applicationId in eas.json",
        }),
      );
    }
    const serviceAccountJson = yield* resolveServiceAccountJson({
      api: inputs.api,
      serviceAccountKeyId: inputs.serviceAccountKeyId,
      serviceAccountKeyPath: inputs.androidProfile.serviceAccountKeyPath,
    });

    yield* patchSubmissionStatus(inputs.api, inputs.submissionId, { status: "IN_PROGRESS" });

    const result = yield* Effect.gen(function* () {
      const token = yield* acquireGooglePlayAccessToken(serviceAccountJson).pipe(
        Effect.mapError(wrapGooglePlayError("AUTH_FAILED")),
      );
      const aab = yield* readArchiveBytes(inputs.archive);
      return yield* runGooglePlayPipeline({
        accessToken: token.accessToken,
        applicationId,
        aab,
        track: inputs.androidProfile.track ?? "internal",
        releaseStatus: inputs.androidProfile.releaseStatus ?? "completed",
        changesNotSentForReview: inputs.androidProfile.changesNotSentForReview ?? false,
        rollout: toDbNull(inputs.androidProfile.rollout),
      });
    }).pipe(
      Effect.catchTag("CliSubmitError", (engineError) =>
        Effect.gen(function* () {
          yield* patchSubmissionStatus(inputs.api, inputs.submissionId, {
            status: "ERRORED",
            errorCode: engineError.code,
            errorMessage: engineError.message,
          });
          return yield* Effect.fail(engineError);
        }),
      ),
    );

    yield* patchSubmissionStatus(inputs.api, inputs.submissionId, { status: "FINISHED" });
    yield* printHuman(`Google Play bundle uploaded (versionCode ${String(result.versionCode)})`);
    return result;
  });
