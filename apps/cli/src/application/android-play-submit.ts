/**
 * Client-side Google Play submission: decrypt the service account key, then run
 * the Play Developer API edit pipeline (insert → upload bundle → assign track →
 * commit) — the same steps `eas submit` performs server-side.
 */
import { readFile } from "node:fs/promises";

import { toDbNull } from "@better-update/type-guards";
import { Effect } from "effect";

import {
  acquireGooglePlayAccessToken,
  commitEdit,
  insertEdit,
  updateTrack,
  uploadBundle,
} from "../lib/google-play";
import { printHuman } from "../lib/output";
import { openFromDownload, openVaultSessionInteractive } from "./credential-cipher";
import { CliSubmitError, patchSubmissionStatus, readArchiveBytes } from "./submit-flow";

import type {
  EasAndroidSubmitProfile,
  EasAndroidSubmitReleaseStatus,
} from "../lib/eas-submit-config";
import type { ApiClient } from "../services/api-client";
import type { ArchiveRef } from "./submit-flow";

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

const readServiceAccountFile = (filePath: string) =>
  Effect.tryPromise({
    try: async () => new TextDecoder().decode(await readFile(filePath)),
    catch: (cause) =>
      new CliSubmitError({
        code: "SUBMISSION_ANDROID_SA_KEY_LOCAL_READ_FAILED",
        message: `Failed to read service account JSON at ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
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
    return readServiceAccountFile(params.serviceAccountKeyPath);
  }
  return Effect.fail(
    new CliSubmitError({
      code: "SUBMISSION_ANDROID_SA_KEY_MISSING",
      message:
        "Android submission requires a service account key. Pass --service-account-key-id <id>, set serviceAccountKeyId in eas.json submit profile, or set serviceAccountKeyPath to a local JSON file.",
    }),
  );
};

const wrapGooglePlayError = (label: string) => (cause: { readonly message: string }) =>
  new CliSubmitError({
    code: `SUBMISSION_ANDROID_${label}`,
    message: cause.message,
  });

/**
 * EAS/Google Play rule: a staged rollout fraction is required for — and only
 * valid with — releaseStatus `inProgress`. Returns an error message, or null
 * when the combination is valid.
 */
export const androidRolloutError = (
  releaseStatus: EasAndroidSubmitReleaseStatus,
  rollout: number | null,
): string | null => {
  if (releaseStatus === "inProgress" && rollout === null) {
    return "rollout is required when releaseStatus is 'inProgress' — set submit.<profile>.android.rollout to a 0–1 fraction.";
  }
  if (releaseStatus !== "inProgress" && rollout !== null) {
    return `rollout is only allowed when releaseStatus is 'inProgress', not '${releaseStatus}'.`;
  }
  return null;
};

interface AndroidGooglePlayUploadInputs {
  readonly api: ApiClient;
  readonly submissionId: string;
  readonly archive: ArchiveRef;
  readonly androidProfile: EasAndroidSubmitProfile;
  readonly serviceAccountKeyId: string | undefined;
}

const runGooglePlayPipeline = (params: {
  readonly accessToken: string;
  readonly applicationId: string;
  readonly aab: Uint8Array;
  readonly track: string;
  readonly releaseStatus: EasAndroidSubmitReleaseStatus;
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
      return yield* new CliSubmitError({
        code: "SUBMISSION_ANDROID_APP_ID_MISSING",
        message:
          "Android submit profile requires applicationId — set submit.<profile>.android.applicationId in eas.json",
      });
    }
    const releaseStatus = inputs.androidProfile.releaseStatus ?? "completed";
    const rollout = toDbNull(inputs.androidProfile.rollout);
    const rolloutError = androidRolloutError(releaseStatus, rollout);
    if (rolloutError !== null) {
      yield* patchSubmissionStatus(inputs.api, inputs.submissionId, {
        status: "ERRORED",
        errorCode: "SUBMISSION_ANDROID_ROLLOUT_INVALID",
        errorMessage: rolloutError,
      });
      return yield* new CliSubmitError({
        code: "SUBMISSION_ANDROID_ROLLOUT_INVALID",
        message: rolloutError,
      });
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
        releaseStatus,
        changesNotSentForReview: inputs.androidProfile.changesNotSentForReview ?? false,
        rollout,
      });
    }).pipe(
      Effect.catchTag("CliSubmitError", (engineError) =>
        Effect.gen(function* () {
          yield* patchSubmissionStatus(inputs.api, inputs.submissionId, {
            status: "ERRORED",
            errorCode: engineError.code,
            errorMessage: engineError.message,
          });
          return yield* engineError;
        }),
      ),
    );

    yield* patchSubmissionStatus(inputs.api, inputs.submissionId, { status: "FINISHED" });
    yield* printHuman(`Google Play bundle uploaded (versionCode ${String(result.versionCode)})`);
    return result;
  });
