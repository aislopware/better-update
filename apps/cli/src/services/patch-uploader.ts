import { Context, Effect, Layer } from "effect";

import { PatchUploadError } from "../lib/exit-codes";
import { formatCause } from "../lib/format-error";
import { ApiClientService } from "./api-client";
import { PresignedUploadClient } from "./presigned-upload";

import type { Platform } from "../lib/build-profile";

export interface UploadPatchInput {
  readonly projectId: string;
  readonly runtimeVersion: string;
  readonly platform: Platform;
  /** Base update the patch was computed against (bspatch oldfile). */
  readonly fromUpdateId: string;
  /** New update the patch reconstructs (bspatch newfile). */
  readonly toUpdateId: string;
  readonly patchFilePath: string;
  readonly byteSize: number;
}

export interface UploadPatchResult {
  /** The server-built R2 key the patch landed at. */
  readonly key: string;
}

// Mirrors UpdateAssetUploader but targets the patches/ key and performs NO
// finalize: the server discovers patches by R2 key probe (resolve-bundle.ts),
// so there is no D1 row and no finalize step. The R2 key is built SERVER-SIDE
// from the request tuple via the shared patchR2Key — never trusted from here.
export class PatchUploader extends Context.Tag("cli/PatchUploader")<
  PatchUploader,
  {
    readonly uploadPatch: (
      input: UploadPatchInput,
    ) => Effect.Effect<UploadPatchResult, PatchUploadError>;
  }
>() {}

export const PatchUploaderLive = Layer.effect(
  PatchUploader,
  Effect.gen(function* () {
    const presignedUploadClient = yield* PresignedUploadClient;
    const apiService = yield* ApiClientService;

    return {
      uploadPatch: (input: UploadPatchInput) =>
        Effect.gen(function* () {
          const api = yield* apiService.get.pipe(
            Effect.mapError(
              (cause) =>
                new PatchUploadError({
                  message: `Patch upload requires authentication: ${formatCause(cause)}`,
                }),
            ),
          );

          const presign = yield* api.assets
            .patchUpload({
              payload: {
                projectId: input.projectId,
                runtimeVersion: input.runtimeVersion,
                platform: input.platform,
                fromUpdateId: input.fromUpdateId,
                toUpdateId: input.toUpdateId,
              },
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new PatchUploadError({
                    message: `Failed to presign patch upload (${input.fromUpdateId} -> ${input.toUpdateId}): ${formatCause(cause)}`,
                  }),
              ),
            );

          yield* presignedUploadClient
            .putToPresignedUrl({
              url: presign.uploadUrl,
              filePath: input.patchFilePath,
              byteSize: input.byteSize,
              expiresAt: presign.uploadExpiresAt,
              headers: presign.uploadHeaders,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new PatchUploadError({
                    message: `Patch PUT failed (${input.fromUpdateId} -> ${input.toUpdateId}): ${formatCause(cause)}`,
                  }),
              ),
            );

          return { key: presign.key } as const satisfies UploadPatchResult;
        }),
    };
  }),
);
