import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compact } from "@better-update/type-guards";
import { Effect, Schema } from "effect";

import type { CreateSubmissionBody, Submission } from "@better-update/api";

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
export const resolveLocalArchivePath = (archive: ArchiveRef, extension: string) =>
  archive.source === "path"
    ? Effect.succeed(localPathFromArchiveValue(archive.value))
    : downloadArchiveToTempFile(archive.value, extension);
