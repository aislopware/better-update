import { Effect } from "effect";

import type { FileSystem } from "@effect/platform";

import { UpdatePublishError } from "../lib/exit-codes";
import { findExportedSourcemap } from "../lib/expo-export";
import { formatCause } from "../lib/format-error";
import { printHuman } from "../lib/output";
import { sha256File } from "../lib/sha256";
import { PresignedUploadClient } from "../services/presigned-upload";

import type { Platform } from "../lib/build-profile";
import type { OutputMode } from "../lib/output-mode";
import type { ApiClient } from "../services/api-client";

/**
 * Store the launch bundle's sourcemap with the update (reserve → presigned
 * PUT → complete). Returns false when the export emitted no map next to the
 * bundle. The public wrapper below makes this best-effort.
 */
const uploadUpdateSourcemap = (
  api: ApiClient,
  params: { readonly updateId: string; readonly bundlePath: string },
): Effect.Effect<boolean, UpdatePublishError, PresignedUploadClient | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const sourcemapPath = yield* findExportedSourcemap({ bundlePath: params.bundlePath });
    if (!sourcemapPath) {
      return false;
    }
    const presignedUploadClient = yield* PresignedUploadClient;
    const { sha256, byteSize } = yield* sha256File(sourcemapPath).pipe(
      Effect.mapError(
        (cause) =>
          new UpdatePublishError({ message: `Failed to hash sourcemap: ${formatCause(cause)}` }),
      ),
    );
    const reservation = yield* api.updates
      .reserveSourcemap({ path: { id: params.updateId }, payload: { sha256, byteSize } })
      .pipe(
        Effect.mapError(
          (cause) =>
            new UpdatePublishError({
              message: `Failed to reserve sourcemap upload: ${formatCause(cause)}`,
            }),
        ),
      );
    yield* presignedUploadClient
      .putToPresignedUrl({
        url: reservation.uploadUrl,
        filePath: sourcemapPath,
        byteSize,
        expiresAt: reservation.uploadExpiresAt,
        headers: reservation.uploadHeaders,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new UpdatePublishError({
              message: `Failed to upload sourcemap: ${formatCause(cause)}`,
            }),
        ),
      );
    yield* api.updates
      .completeSourcemap({ path: { id: params.updateId }, payload: { sha256, byteSize } })
      .pipe(
        Effect.mapError(
          (cause) =>
            new UpdatePublishError({
              message: `Failed to finalize sourcemap: ${formatCause(cause)}`,
            }),
        ),
      );
    return true;
  });

/**
 * Best-effort sourcemap storage for crash symbolication: skipped when
 * `--no-source-maps` was passed or the export produced no launch bundle, and
 * a failure only prints a note — it never fails the publish.
 */
export const storeSourcemapBestEffort = (
  api: ApiClient,
  params: {
    readonly enabled: boolean;
    readonly platform: Platform;
    readonly updateId: string;
    readonly bundlePath: string | undefined;
  },
): Effect.Effect<boolean, never, PresignedUploadClient | FileSystem.FileSystem | OutputMode> => {
  const { bundlePath } = params;
  if (!params.enabled || bundlePath === undefined) {
    return Effect.succeed(false);
  }
  return uploadUpdateSourcemap(api, { updateId: params.updateId, bundlePath }).pipe(
    Effect.catchAll((cause) =>
      printHuman(`Sourcemap upload skipped for ${params.platform}: ${formatCause(cause)}`).pipe(
        Effect.as(false),
      ),
    ),
  );
};
