/**
 * Native App Store Connect **Build Upload API** client (ASC API 4.1) — the REST
 * replacement for `xcrun altool`: reserve the upload, PUT the presigned chunks
 * Apple hands back (with byte progress), commit, then poll delivery state.
 *
 * Flow: `POST /v1/buildUploads` → `POST /v1/buildUploadFiles` (returns
 * `uploadOperations`) → chunk PUTs → `PATCH /v1/buildUploadFiles/{id}`
 * (`uploaded: true`) → poll the file's `assetDeliveryState`, then briefly poll
 * the buildUpload `state` to fast-fail early validation rejects.
 *
 * Auth is the same vault ASC API key the CLI uses everywhere else; the JWT is
 * minted by apple-utils' `Token` (never hand-rolled). Chunk PUT URLs are
 * presigned and self-contained — no Authorization header on those requests.
 *
 * A duplicate build (this CFBundleVersion already on ASC) is rejected by Apple
 * at the reserve step — HTTP 409 with every error code
 * `ENTITY_ERROR.ATTRIBUTE.INVALID.DUPLICATE` — before any bytes upload, and is
 * surfaced as the benign `alreadyUploaded` outcome (altool's "Redundant Binary
 * Upload" parity).
 */
import { open, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

import { pollBuildUploadState, pollFileDelivery, requestJson } from "./asc-build-upload-http";
import {
  AscBuildUploadError,
  AscBuildUploadUnavailableError,
  BuildUploadFileResource,
  BuildUploadResource,
  chunkRequestHeaders,
  decodeOr,
  formatAscErrors,
  isDuplicateBuildUploadConflict,
  parseAscErrors,
} from "./asc-build-upload-parse";

import type { AscUploadOperation, FetchFn } from "./asc-build-upload-parse";
import type { AscCredentials } from "./asc-credentials";
import type { OutputMode } from "./output-mode";
import type { UploadProgressReporter } from "./upload-progress";

const CHUNK_CONCURRENCY = 4;
const CHUNK_ATTEMPTS = 2;

/** Everything the callers need is re-exported so the split stays invisible. */
export {
  AscBuildUploadError,
  AscBuildUploadUnavailableError,
  chunkRequestHeaders,
  explainBuildUploadFailure,
  formatAscErrors,
  isDeliveredFileState,
  isDuplicateBuildUploadConflict,
  parseAscErrors,
} from "./asc-build-upload-parse";
export type { AscUploadOperation, FetchFn } from "./asc-build-upload-parse";

// ── Reserve phase ────────────────────────────────────────────────────────────

interface ReserveOutcome {
  readonly kind: "reserved" | "already-uploaded";
  readonly buildUploadId: string;
}

/**
 * `POST /v1/buildUploads`. 409-duplicate → benign `already-uploaded`; auth,
 * rate-limit, or availability failures (401/403/404/429/5xx) →
 * {@link AscBuildUploadUnavailableError} so the caller can fall back to altool
 * before any bytes moved.
 */
const createBuildUpload = (params: {
  readonly token: AppleUtils.Token;
  readonly fetchFn: FetchFn;
  readonly appId: string;
  readonly shortVersion: string;
  readonly buildVersion: string;
}): Effect.Effect<ReserveOutcome, AscBuildUploadError | AscBuildUploadUnavailableError> =>
  Effect.gen(function* () {
    const response = yield* requestJson({
      token: params.token,
      fetchFn: params.fetchFn,
      method: "POST",
      path: "/buildUploads",
      step: "Build upload reservation",
      body: {
        data: {
          type: "buildUploads",
          attributes: {
            platform: "IOS",
            cfBundleShortVersionString: params.shortVersion,
            cfBundleVersion: params.buildVersion,
          },
          relationships: { app: { data: { type: "apps", id: params.appId } } },
        },
      },
    }).pipe(
      Effect.mapError(
        // A network failure at the very first call is indistinguishable from
        // "API unreachable" — keep it fallback-eligible.
        (error) => new AscBuildUploadUnavailableError({ message: error.message }),
      ),
    );
    if (response.status === 201) {
      const resource = yield* decodeOr(BuildUploadResource, response.body, "Build upload creation");
      return { kind: "reserved", buildUploadId: resource.data.id } as const;
    }
    const errors = parseAscErrors(response.body);
    if (isDuplicateBuildUploadConflict(response.status, errors)) {
      return { kind: "already-uploaded", buildUploadId: "" } as const;
    }
    const detail = `POST /v1/buildUploads returned ${String(response.status)}: ${formatAscErrors(errors)}`;
    if ([401, 403, 404, 429].includes(response.status) || response.status >= 500) {
      return yield* new AscBuildUploadUnavailableError({ message: detail });
    }
    return yield* new AscBuildUploadError({
      code: "ASC_BUILD_UPLOAD_CREATE_FAILED",
      message: detail,
    });
  });

const reserveBuildUploadFile = (params: {
  readonly token: AppleUtils.Token;
  readonly fetchFn: FetchFn;
  readonly buildUploadId: string;
  readonly fileName: string;
  readonly fileSize: number;
}) =>
  Effect.gen(function* () {
    const response = yield* requestJson({
      token: params.token,
      fetchFn: params.fetchFn,
      method: "POST",
      path: "/buildUploadFiles",
      step: "Build upload file reservation",
      body: {
        data: {
          type: "buildUploadFiles",
          attributes: {
            assetType: "ASSET",
            fileName: params.fileName,
            fileSize: params.fileSize,
            uti: "com.apple.ipa",
          },
          relationships: {
            buildUpload: { data: { type: "buildUploads", id: params.buildUploadId } },
          },
        },
      },
    });
    if (response.status !== 201) {
      return yield* new AscBuildUploadError({
        code: "ASC_BUILD_UPLOAD_FILE_RESERVE_FAILED",
        message: `POST /v1/buildUploadFiles returned ${String(response.status)}: ${formatAscErrors(parseAscErrors(response.body))}`,
      });
    }
    const resource = yield* decodeOr(
      BuildUploadFileResource,
      response.body,
      "Build upload file reservation",
    );
    const operations = resource.data.attributes?.uploadOperations;
    if (!operations || operations.length === 0) {
      return yield* new AscBuildUploadError({
        code: "ASC_BUILD_UPLOAD_NO_OPERATIONS",
        message: "App Store Connect returned no upload operations for the reserved file.",
      });
    }
    return { fileId: resource.data.id, operations };
  });

// ── Chunk PUTs ───────────────────────────────────────────────────────────────

const readChunk = (fileHandle: FileHandle, operation: AscUploadOperation) =>
  Effect.tryPromise({
    try: async () => {
      const buffer = new Uint8Array(operation.length);
      const { bytesRead } = await fileHandle.read(buffer, 0, operation.length, operation.offset);
      return { buffer, bytesRead };
    },
    catch: (cause) =>
      new AscBuildUploadError({
        code: "ASC_BUILD_UPLOAD_READ_FAILED",
        message: `Could not read the IPA chunk: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  }).pipe(
    Effect.flatMap(({ buffer, bytesRead }) =>
      bytesRead === operation.length
        ? Effect.succeed(buffer)
        : Effect.fail(
            new AscBuildUploadError({
              code: "ASC_BUILD_UPLOAD_READ_FAILED",
              message: `Short read: expected ${String(operation.length)} bytes at offset ${String(operation.offset)}, got ${String(bytesRead)}.`,
            }),
          ),
    ),
  );

const putChunkOnce = (
  fetchFn: FetchFn,
  operation: AscUploadOperation,
  bytes: Uint8Array<ArrayBuffer>,
) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetchFn(operation.url, {
        method: operation.method,
        headers: chunkRequestHeaders(operation),
        body: bytes,
      });
      return response.status;
    },
    catch: (cause) =>
      new AscBuildUploadError({
        code: "ASC_BUILD_UPLOAD_CHUNK_FAILED",
        message: `Chunk upload failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  }).pipe(
    Effect.flatMap((status) =>
      status >= 200 && status < 300
        ? Effect.void
        : Effect.fail(
            new AscBuildUploadError({
              code: "ASC_BUILD_UPLOAD_CHUNK_FAILED",
              message: `Chunk upload returned HTTP ${String(status)}.`,
            }),
          ),
    ),
  );

/** PUT one presigned chunk, retrying once — the PUTs are idempotent. */
const putChunk = (
  fetchFn: FetchFn,
  operation: AscUploadOperation,
  bytes: Uint8Array<ArrayBuffer>,
) => putChunkOnce(fetchFn, operation, bytes).pipe(Effect.retry({ times: CHUNK_ATTEMPTS - 1 }));

const uploadChunks = (params: {
  readonly fetchFn: FetchFn;
  readonly fileHandle: FileHandle;
  readonly operations: readonly AscUploadOperation[];
  readonly reporter: UploadProgressReporter;
}) =>
  Effect.forEach(
    params.operations,
    (operation) =>
      Effect.gen(function* () {
        const bytes = yield* readChunk(params.fileHandle, operation);
        yield* putChunk(params.fetchFn, operation, bytes);
        yield* params.reporter.advance(operation.length);
      }),
    { concurrency: CHUNK_CONCURRENCY, discard: true },
  );

// ── Commit + polling ─────────────────────────────────────────────────────────

const commitBuildUploadFile = (params: {
  readonly token: AppleUtils.Token;
  readonly fetchFn: FetchFn;
  readonly fileId: string;
}) =>
  Effect.gen(function* () {
    const response = yield* requestJson({
      token: params.token,
      fetchFn: params.fetchFn,
      method: "PATCH",
      path: `/buildUploadFiles/${params.fileId}`,
      step: "Build upload commit",
      body: {
        data: { type: "buildUploadFiles", id: params.fileId, attributes: { uploaded: true } },
      },
    });
    if (response.status < 200 || response.status >= 300) {
      return yield* new AscBuildUploadError({
        code: "ASC_BUILD_UPLOAD_COMMIT_FAILED",
        message: `PATCH /v1/buildUploadFiles returned ${String(response.status)}: ${formatAscErrors(parseAscErrors(response.body))}`,
      });
    }
    return undefined;
  });

// ── Entry point ──────────────────────────────────────────────────────────────

export interface AscBuildUploadInputs {
  readonly credentials: AscCredentials;
  /** App Store Connect app id (the `apps` resource id) the build belongs to. */
  readonly appId: string;
  readonly ipaPath: string;
  /** CFBundleShortVersionString from the IPA. */
  readonly shortVersion: string;
  /** CFBundleVersion from the IPA — the number ASC dedupes on. */
  readonly buildVersion: string;
  readonly reporter: UploadProgressReporter;
  /** Injectable for tests; defaults to global fetch. */
  readonly fetchFn?: FetchFn;
}

export interface AscBuildUploadOutcome {
  /** True when Apple already had this build number and no bytes were uploaded. */
  readonly alreadyUploaded: boolean;
}

const openIpa = (ipaPath: string) =>
  Effect.tryPromise({
    try: async () => {
      const info = await stat(ipaPath);
      const handle = await open(ipaPath, "r");
      return { handle, size: info.size };
    },
    catch: (cause) =>
      new AscBuildUploadError({
        code: "ASC_BUILD_UPLOAD_READ_FAILED",
        message: `Could not open the IPA at ${ipaPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });

/**
 * Upload an `.ipa` through the Build Upload API with byte progress. Fails with
 * {@link AscBuildUploadUnavailableError} only before any bytes moved, so the
 * caller can transparently fall back to `altool`.
 */
export const uploadIpaViaBuildUploadApi = (
  inputs: AscBuildUploadInputs,
): Effect.Effect<
  AscBuildUploadOutcome,
  AscBuildUploadError | AscBuildUploadUnavailableError,
  OutputMode
> =>
  Effect.gen(function* () {
    const fetchFn: FetchFn = inputs.fetchFn ?? (async (input, init) => fetch(input, init));
    const token = new AppleUtils.Token({
      key: inputs.credentials.p8Pem,
      keyId: inputs.credentials.keyId,
      issuerId: inputs.credentials.issuerId,
    });

    const reserved = yield* createBuildUpload({
      token,
      fetchFn,
      appId: inputs.appId,
      shortVersion: inputs.shortVersion,
      buildVersion: inputs.buildVersion,
    });
    if (reserved.kind === "already-uploaded") {
      return { alreadyUploaded: true };
    }

    const uploadedAll = yield* Effect.acquireUseRelease(
      openIpa(inputs.ipaPath),
      ({ handle, size }) =>
        Effect.gen(function* () {
          const file = yield* reserveBuildUploadFile({
            token,
            fetchFn,
            buildUploadId: reserved.buildUploadId,
            fileName: path.basename(inputs.ipaPath),
            fileSize: size,
          });
          yield* inputs.reporter.start(size);
          // Any failure between start and finish MUST stop the reporter: the
          // TTY progress bar runs a redraw interval that would otherwise keep
          // the process alive and clobber the printed error.
          yield* uploadChunks({
            fetchFn,
            fileHandle: handle,
            operations: file.operations,
            reporter: inputs.reporter,
          }).pipe(
            Effect.zipRight(commitBuildUploadFile({ token, fetchFn, fileId: file.fileId })),
            Effect.zipRight(pollFileDelivery({ token, fetchFn, fileId: file.fileId })),
            Effect.tapError((error) => inputs.reporter.fail(`Upload failed: ${error.message}`)),
          );
          yield* inputs.reporter.finish("Upload delivered to App Store Connect.");
          return true;
        }),
      ({ handle }) => Effect.promise(async () => handle.close()),
    );

    if (uploadedAll) {
      yield* pollBuildUploadState({ token, fetchFn, buildUploadId: reserved.buildUploadId });
    }
    return { alreadyUploaded: false };
  });
